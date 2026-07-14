#!/usr/bin/env python3
"""
Read azure-az104.json (German), batch-translate text fields to English,
write azure-az104-en.json.

Usage: python3 translate_az104.py
Output: ../questions/azure-az104-en.json

Uses a JSON-based batch approach: extracts all text that needs translation,
outputs batches for applepi, then reassembles.
"""
import json, sys, os, re

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
QUESTIONS_DIR = os.path.join(SCRIPT_DIR, '..', 'questions')
SRC = os.path.join(QUESTIONS_DIR, 'azure-az104.json')
DST = os.path.join(QUESTIONS_DIR, 'azure-az104-en.json')

with open(SRC) as f:
    data = json.load(f)

# Questions array
qs = data['questions']
print(f"Loaded {len(qs)} questions from {SRC}")

# ============================================================
# STEP 1: Extract all text fields that need translation
# ============================================================
# We'll group by question and produce a mapping from field key → German text
# Field keys: q_{id}.question, q_{id}.option_{optId}, q_{id}.explanation

text_map = {}  # key → German text
reverse_map = {}  # German text → [key(s)]

for q in qs:
    qid = q['id']
    text_map[f'{qid}.question'] = q['question']
    for o in q['options']:
        text_map[f'{qid}.option_{o["id"]}'] = o['text']
    text_map[f'{qid}.explanation'] = q['explanation']

print(f"Total text fields to translate: {len(text_map)}")
print(f"Total characters: {sum(len(v) for v in text_map.values())}")

# ============================================================
# STEP 2: Output translation batches (for applepi processing)
# ============================================================
# Each batch contains ~5 questions (roughly 20 text fields)

BATCH_SIZE = 5  # questions per batch
batches = []
current_batch = {}
current_count = 0

for q in qs:
    qid = q['id']
    batch_entry = {}
    batch_entry[f'{qid}.question'] = text_map[f'{qid}.question']
    for o in q['options']:
        batch_entry[f'{qid}.option_{o["id"]}'] = text_map[f'{qid}.option_{o["id"]}']
    batch_entry[f'{qid}.explanation'] = text_map[f'{qid}.explanation']
    current_batch.update(batch_entry)
    current_count += 1
    if current_count >= BATCH_SIZE:
        batches.append(current_batch)
        current_batch = {}
        current_count = 0

if current_batch:
    batches.append(current_batch)

print(f"\nCreated {len(batches)} batches of ~{BATCH_SIZE} questions each.")
print("\n" + "="*60)
print("TRANSLATION INSTRUCTIONS FOR APPLEPI")
print("="*60)

for i, batch in enumerate(batches):
    print(f"\n--- BATCH {i+1}/{len(batches)} ---")
    print("INPUT (German → English JSON translation):")
    print(json.dumps(batch, ensure_ascii=False, indent=2))
    print("\nTranslate ALL text fields from German to English.")
    print("Keep Azure service names (e.g., 'Entra ID', 'Conditional Access') in English.")
    print("Keep markdown formatting (**bold**, *italic*, - lists).")
    print("Output valid JSON with same keys and English values.\n")

print("\n" + "="*60)
print("To translate, call applepi for each batch with the prompt above.")
print("="*60)

# Also write the batches to files for easy reference
batch_dir = os.path.join(SCRIPT_DIR, 'translation_batches')
os.makedirs(batch_dir, exist_ok=True)

for i, batch in enumerate(batches):
    with open(os.path.join(batch_dir, f'batch_{i+1:02d}_input.json'), 'w') as f:
        json.dump(batch, f, ensure_ascii=False, indent=2)

# Write a processing script
with open(os.path.join(SCRIPT_DIR, 'apply_translations.py'), 'w') as f:
    f.write('''#!/usr/bin/env python3
"""Apply translated batches back to the English JSON."""
import json, os, glob, re

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
QUESTIONS_DIR = os.path.join(SCRIPT_DIR, '..', 'questions')
SRC = os.path.join(QUESTIONS_DIR, 'azure-az104.json')
DST = os.path.join(QUESTIONS_DIR, 'azure-az104-en.json')
BATCH_DIR = os.path.join(SCRIPT_DIR, 'translation_batches')

with open(SRC) as f:
    data = json.load(f)

# Load all translated batches
translations = {}  # key → English text
for fpath in sorted(glob.glob(os.path.join(BATCH_DIR, 'batch_*_output.json'))):
    with open(fpath) as f:
        batch = json.load(f)
    translations.update(batch)

print(f"Loaded {len(translations)} translated text fields")

# Apply translations to the data
qs = data['questions']
for q in qs:
    qid = q['id']
    key_q = f'{qid}.question'
    if key_q in translations:
        q['question'] = translations[key_q]
    else:
        print(f"WARNING: Missing translation for {key_q}")
    
    for o in q['options']:
        key_o = f'{qid}.option_{o["id"]}'
        if key_o in translations:
            o['text'] = translations[key_o]
        else:
            print(f"WARNING: Missing translation for {key_o}")
    
    key_e = f'{qid}.explanation'
    if key_e in translations:
        q['explanation'] = translations[key_e]
    else:
        print(f"WARNING: Missing translation for {key_e}")

# Update meta label
data['meta']['label'] = 'Azure AZ-104 (English)'
data['meta']['description'] = 'Microsoft Azure Administrator (English)'
data['meta']['id'] = 'azure-az104-en'
data['meta']['exam']['info'] = '100 minutes · 40–60 questions · Pass at 700/1000 · Single-choice, multiple-answer, drag-and-drop. No negative marking for guessing.'

# Write English file
with open(DST, 'w') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"Written {DST}")
print(f"Total questions: {len(qs)}")
''')

print(f"\nBatch input files written to {batch_dir}/")
print("Run: for each batch, use applepi_query to translate, save as batch_XX_output.json")
print("Then run: python3 apply_translations.py")