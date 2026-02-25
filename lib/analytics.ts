/**
 * Statistical utility functions for GLEU analytics.
 */

/**
 * Probability Density Function (PDF) for a Normal (Gaussian) distribution.
 * f(x) = (1 / (sigma * sqrt(2 * PI))) * e^(-0.5 * ((x - mu) / sigma)^2)
 */
export function normalPDF(x: number, mu: number, sigma: number): number {
  const exponent = -0.5 * Math.pow((x - mu) / sigma, 2)
  const coefficient = 1 / (sigma * Math.sqrt(2 * Math.PI))
  return coefficient * Math.exp(exponent)
}

/**
 * Pearson Correlation Coefficient (r).
 * Measures the linear correlation between two arrays of numbers.
 * Returns a value between -1 and 1.
 */
export function pearsonCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length === 0) return 0

  const n = x.length
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0

  for (let i = 0; i < n; i++) {
    sumX += x[i]
    sumY += y[i]
    sumXY += x[i] * y[i]
    sumX2 += x[i] * x[i]
    sumY2 += y[i] * y[i]
  }

  const numerator = n * sumXY - sumX * sumY
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY))

  if (denominator === 0) return 0
  return numerator / denominator
}

/**
 * Simple Linear Regression.
 * Returns the slope (m) and intercept (b) for the line y = mx + b.
 */
export function linearRegression(x: number[], y: number[]): { m: number; b: number } {
  if (x.length !== y.length || x.length === 0) return { m: 0, b: 0 }

  const n = x.length
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0

  for (let i = 0; i < n; i++) {
    sumX += x[i]
    sumY += y[i]
    sumXY += x[i] * y[i]
    sumX2 += x[i] * x[i]
  }

  const denominator = n * sumX2 - sumX * sumX
  if (denominator === 0) return { m: 0, b: sumY / n }

  const m = (n * sumXY - sumX * sumY) / denominator
  const b = (sumY - m * sumX) / n

  return { m, b }
}
