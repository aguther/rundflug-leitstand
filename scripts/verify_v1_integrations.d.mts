export interface IntegrationShard {
  name: string;
  suites: readonly string[];
}

export const integrationShards: readonly IntegrationShard[];
export const suites: readonly string[];

export function parseShardSelection(argumentsList: readonly string[]): IntegrationShard;

export function runSequentialSuites<Result>(input: {
  selectedSuites: readonly string[];
  shardName: string;
  runSuite: (suite: string, shardName: string) => Promise<Result>;
}): Promise<Result[]>;
