export type ProjectStatus = {
    name: string;
    path: string;
    required: string | null;
    matches: boolean | null;
};

export type NvmrcStatus =
    | { kind: 'not-node-project'; projects: [] }
    | { kind: 'node-not-found'; projects: ProjectStatus[] }
    | { kind: 'ready'; current: string; projects: ProjectStatus[] };

export type NvmInstalledVersion = {
    version: string;
    active: boolean;
};
