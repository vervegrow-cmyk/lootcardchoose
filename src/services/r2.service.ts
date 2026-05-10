export type R2Service = {
  listObjects: (prefix?: string) => Promise<string[]>;
};
