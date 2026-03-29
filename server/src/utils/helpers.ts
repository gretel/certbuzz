export function generateSessionCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function calculateScore(correctAnswers: number, totalTimeSeconds: number): number {
  // Racing scoring: 1000 points per correct answer, -1 point per second
  // This makes time more impactful (previously -0.5 per second)
  return correctAnswers * 1000 - totalTimeSeconds;
}

export function checkAnswer(selected: string[], correct: string[], type: 'single' | 'multiple' | 'order'): boolean {
  if (type === 'order') {
    return JSON.stringify(selected) === JSON.stringify(correct);
  }

  if (selected.length !== correct.length) return false;

  const sortedSelected = [...selected].sort();
  const sortedCorrect = [...correct].sort();

  return JSON.stringify(sortedSelected) === JSON.stringify(sortedCorrect);
}

const EMOJI_POOL = [
  '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯',
  '🦁', '🐮', '🐷', '🐸', '🐵', '🦆', '🦅', '🦉', '🦋', '🐢',
  '🐬', '🦈', '🐙', '🦄', '🐲', '🦓', '🦒', '🦘', '🦔', '🐧',
];

export function getRandomEmoji(): string {
  return EMOJI_POOL[Math.floor(Math.random() * EMOJI_POOL.length)];
}
