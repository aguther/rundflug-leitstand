export const exclusiveSuites: readonly string[];
export const isolatedSuites: readonly string[];
export const suites: readonly string[];

export interface IntegrationSuiteLane {
  name: string;
  laneSuites: readonly string[];
}

export function runSuiteLanes<Result>(input: {
  lanes: readonly IntegrationSuiteLane[];
  runSuite: (suite: string, lane: string) => Promise<Result>;
}): Promise<Result[]>;
