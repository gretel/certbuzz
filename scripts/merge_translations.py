#!/usr/bin/env python3
"""Load translations JSON, apply to German bank, write English bank."""
import json, os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
QUESTIONS_DIR = os.path.join(SCRIPT_DIR, '..', 'questions')
SRC = os.path.join(QUESTIONS_DIR, 'azure-az104.json')
TRANS = os.path.join(SCRIPT_DIR, 'az104_en_translations.json')
DST = os.path.join(QUESTIONS_DIR, 'azure-az104-en.json')

with open(SRC) as f:
    data = json.load(f)
with open(TRANS) as f:
    en = json.load(f)

qs = data['questions']
applied = 0
missing = 0
for q in qs:
    qid = q['id']
    key_q = f'{qid}.question'
    if key_q in en:
        q['question'] = en[key_q]
        applied += 1
    else:
        missing += 1
        print(f'MISSING: {key_q}')
    for o in q['options']:
        key_o = f'{qid}.option_{o["id"]}'
        if key_o in en:
            o['text'] = en[key_o]
            applied += 1
        else:
            missing += 1
            print(f'MISSING: {key_o}')
    key_e = f'{qid}.explanation'
    if key_e in en:
        q['explanation'] = en[key_e]
        applied += 1
    else:
        missing += 1
        print(f'MISSING: {key_e}')

# Meta updates
data['meta']['id'] = 'azure-az104-en'
data['meta']['label'] = 'Azure AZ-104 (English)'
data['meta']['description'] = 'Microsoft Azure Administrator (English)'
data['meta']['exam']['info'] = '100 minutes · 40–60 questions · Pass at 700/1000 · Single-choice, multiple-answer, drag-and-drop. No negative marking for guessing.'

with open(DST, 'w') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f'Written {DST}: {len(qs)} questions')
print(f'Applied: {applied}, Missing: {missing}')