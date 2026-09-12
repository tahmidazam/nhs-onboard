/** One extraction call that failed twice, as `convex/board.ts` returns it. */
export interface ExtractionFailure {
  documentId: string
  /** Absent when the document has since been deleted. */
  documentKind?: string
  agent: string
  message: string
}

/** One patient's live extraction signal: claims so far, and any call that failed. */
export interface ExtractionProgress {
  claimCount: number
  failures: ExtractionFailure[]
}
