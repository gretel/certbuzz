/**
 * Compute dense ranks for a sorted leaderboard.
 * Players with the same score share the same rank position.
 * Example: scores [1000, 800, 800, 500] -> ranks [1, 2, 2, 3]
 *
 * @param entries - Array sorted descending by score
 * @returns Array of rank numbers (1-indexed), same length as entries
 */
export function computeDenseRanks(entries: Array<{ score: number }>): number[] {
  const ranks: number[] = [];
  let currentRank = 0;
  let prevScore: number | null = null;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].score !== prevScore) {
      currentRank++;
      prevScore = entries[i].score;
    }
    ranks.push(currentRank);
  }
  return ranks;
}

/**
 * Get medal/rank CSS classes based on dense rank.
 * Rank 1 = gold, rank 2 = silver, rank 3 = bronze, else neutral.
 */
export function getRankStyle(rank: number): string {
  if (rank === 1) return 'bg-yellow-400 text-yellow-900';
  if (rank === 2) return 'bg-gray-300 text-gray-700';
  if (rank === 3) return 'bg-orange-400 text-orange-900';
  return 'bg-white/10 text-white/60';
}
