import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeProportionalCounts } from './questionBank.js';
import type { ExamDomain } from './questionBank.js';

const clfDomains: ExamDomain[] = [
  { id: 'concepts', label: 'Cloud Concepts',                weight: 24, categories: [] },
  { id: 'security', label: 'Security and Compliance',       weight: 30, categories: [] },
  { id: 'tech',     label: 'Cloud Technology and Services', weight: 34, categories: [] },
  { id: 'billing',  label: 'Billing, Pricing, and Support', weight: 12, categories: [] },
];

test('CLF-C02 weights sum to exactly 65 via largest-remainder', () => {
  const counts = computeProportionalCounts(clfDomains, 65);
  assert.equal(counts.concepts, 16);
  assert.equal(counts.security, 19);
  assert.equal(counts.tech, 22);
  assert.equal(counts.billing, 8);
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  assert.equal(total, 65);
});

test('Single domain at 100% weight gets all questions', () => {
  const domains: ExamDomain[] = [{ id: 'only', label: 'Only', weight: 100, categories: [] }];
  const counts = computeProportionalCounts(domains, 50);
  assert.equal(counts.only, 50);
});

test('Even split distributes evenly', () => {
  const domains: ExamDomain[] = [
    { id: 'a', label: 'A', weight: 25, categories: [] },
    { id: 'b', label: 'B', weight: 25, categories: [] },
    { id: 'c', label: 'C', weight: 25, categories: [] },
    { id: 'd', label: 'D', weight: 25, categories: [] },
  ];
  const counts = computeProportionalCounts(domains, 40);
  assert.equal(counts.a, 10);
  assert.equal(counts.b, 10);
  assert.equal(counts.c, 10);
  assert.equal(counts.d, 10);
});

test('Remainder distribution respects fractional-part order', () => {
  // Weights 33/33/34 for 10 questions: exact 3.3/3.3/3.4 → floor 3/3/3 = 9, 1 leftover
  // Largest remainder is 0.4 (domain c), so it gets the +1 → final 3/3/4 = 10
  const domains: ExamDomain[] = [
    { id: 'a', label: 'A', weight: 33, categories: [] },
    { id: 'b', label: 'B', weight: 33, categories: [] },
    { id: 'c', label: 'C', weight: 34, categories: [] },
  ];
  const counts = computeProportionalCounts(domains, 10);
  assert.equal(counts.a + counts.b + counts.c, 10);
  assert.equal(counts.c, 4);
});

test('Zero total questions returns all zeros', () => {
  const counts = computeProportionalCounts(clfDomains, 0);
  assert.equal(counts.concepts, 0);
  assert.equal(counts.security, 0);
  assert.equal(counts.tech, 0);
  assert.equal(counts.billing, 0);
});

test('Empty domain list returns empty object', () => {
  const counts = computeProportionalCounts([], 65);
  assert.deepEqual(counts, {});
});
