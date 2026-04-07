import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const questionsDir = path.join(__dirname, '../../../questions');

// --- Bank file schema ---
// Each file in questions/ is a JSON file with this shape:
//
// {
//   "meta": {
//     "id": "azure-az104",
//     "label": "Azure AZ-104",
//     "description": "Microsoft Azure Administrator",
//     "categories": {
//       "category-slug": { "label": "Human Label", "icon": "🔐" }
//     }
//   },
//   "questions": [ ...Question[] ]
// }

export interface Question {
  id: string;
  category: string;
  type: 'single' | 'multiple' | 'order';
  difficulty: 'easy' | 'medium' | 'hard';
  question: string;
  options: Array<{ id: string; text: string }>;
  correctAnswers: string[];
  explanation: string;
  references?: string[];
}

export interface ExamDomain {
  id: string;
  label: string;
  weight: number;         // 0-100, weights across all domains sum to 100
  categories: string[];   // bank category slugs that belong to this domain
}

export interface ExamInfo {
  passPercent: number;
  totalQuestions: number;
  info: string;
  // Optional exam-mode extensions — if absent, bank cannot be used in exam mode
  durationMinutes?: number;
  passingScore?: number;
  scaleMin?: number;
  scaleMax?: number;
  domains?: ExamDomain[];
}

interface BankMeta {
  id: string;
  label: string;
  description: string;
  exam?: ExamInfo;
  categories: Record<string, { label: string; icon: string }>;
}

interface BankFile {
  meta: BankMeta;
  questions: Question[];
}

export interface BankMetadata {
  bankId: string;
  label: string;
  description: string;
  exam?: ExamInfo;
  questionCount: number;
  categories: Array<{ id: string; label: string; icon: string; count: number }>;
}

const banksCache = new Map<string, BankFile>();

function loadBank(bankId: string): BankFile {
  const cached = banksCache.get(bankId);
  if (cached) return cached;

  const filePath = path.join(questionsDir, `${bankId}.json`);
  const bank: BankFile = JSON.parse(readFileSync(filePath, 'utf-8'));
  banksCache.set(bankId, bank);
  return bank;
}

export function getQuestions(bankId: string): Question[] {
  return loadBank(bankId).questions;
}

export function getQuestion(bankId: string, questionId: string): Question | undefined {
  return loadBank(bankId).questions.find(q => q.id === questionId);
}

export function getCategories(bankId: string): Array<{ id: string; label: string; icon: string; count: number }> {
  const bank = loadBank(bankId);
  const catMeta = bank.meta.categories;

  const counts = new Map<string, number>();
  for (const q of bank.questions) {
    counts.set(q.category, (counts.get(q.category) || 0) + 1);
  }

  return Array.from(counts.entries()).map(([id, count]) => ({
    id,
    label: catMeta[id]?.label ?? id,
    icon: catMeta[id]?.icon ?? '📝',
    count,
  }));
}

export function getExamInfo(bankId: string): ExamInfo | undefined {
  return loadBank(bankId).meta.exam;
}

export function getAvailableBanks(): BankMetadata[] {
  const files = readdirSync(questionsDir).filter(f => f.endsWith('.json'));
  return files.map(f => {
    const bankId = f.replace('.json', '');
    const bank = loadBank(bankId);
    return {
      bankId,
      label: bank.meta.label,
      description: bank.meta.description,
      exam: bank.meta.exam,
      questionCount: bank.questions.length,
      categories: getCategories(bankId),
    };
  });
}

// ========== EXAM MODE SAMPLING ==========

/**
 * Distribute a total count across domains proportionally to their weights
 * using the largest-remainder (Hare quota) method. Always returns exactly
 * `total` items summed across all domains.
 *
 * Tie-break: when two domains share the same fractional remainder, the one
 * declared earlier in the input array wins the +1 allocation.
 */
export function computeProportionalCounts(
  domains: ExamDomain[],
  total: number
): Record<string, number> {
  if (domains.length === 0) return {};
  if (total === 0) {
    return Object.fromEntries(domains.map(d => [d.id, 0]));
  }

  const exact = domains.map((d, idx) => ({
    id: d.id,
    originalIndex: idx,
    exactValue: (total * d.weight) / 100,
  }));

  const floored = exact.map(e => ({
    id: e.id,
    originalIndex: e.originalIndex,
    count: Math.floor(e.exactValue),
    remainder: e.exactValue - Math.floor(e.exactValue),
  }));

  const baseSum = floored.reduce((sum, f) => sum + f.count, 0);
  const leftover = total - baseSum;

  // Sort by remainder descending; ties broken by original declaration order
  const sorted = [...floored].sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    return a.originalIndex - b.originalIndex;
  });

  for (let i = 0; i < leftover; i++) {
    sorted[i].count += 1;
  }

  // Return in a stable map keyed by domain id (restore original order)
  const result: Record<string, number> = {};
  for (const d of domains) {
    result[d.id] = sorted.find(s => s.id === d.id)!.count;
  }
  return result;
}
