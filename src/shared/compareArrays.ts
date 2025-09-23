// src/shared/compareArrays.ts

/** Similarity of two string arrays in %, order-robust (LCS-based). */
export function compareArrays(a: string[], b: string[]): number {
    const n = a.length, m = b.length;
    if (n === 0 && m === 0) return 100;
    const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1] + 1
                : Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
    }
    return (dp[n][m] / Math.max(n, m)) * 100;
}