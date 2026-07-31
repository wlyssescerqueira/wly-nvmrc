export type NvmrcStatus =
    | { kind: 'not-node-project' }
    | { kind: 'node-not-found'; required: string | null }
    | { kind: 'no-nvmrc'; current: string }
    | { kind: 'match'; current: string; required: string }
    | { kind: 'mismatch'; current: string; required: string };

export type NvmInstalledVersion = {
    version: string;
    active: boolean;
};
