export const exclusiveSuites: readonly string[];
export const isolatedSuites: readonly string[];
export const serialSuites: readonly string[];
export const suites: readonly string[];

export interface IntegrationSuiteLane {
  name: string;
  laneSuites: readonly string[];
}

export function runIntegrationSchedule<Result>(input: {
  lanes: readonly IntegrationSuiteLane[];
  serialSuites: readonly string[];
  runSuite: (suite: string, lane: string) => Promise<Result>;
}): Promise<Result[]>;

export function runSuiteLanes<Result>(input: {
  lanes: readonly IntegrationSuiteLane[];
  runSuite: (suite: string, lane: string) => Promise<Result>;
}): Promise<Result[]>;
