#!/usr/bin/env python3
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
