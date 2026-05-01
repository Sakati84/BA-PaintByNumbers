
export type RGB = number[];

export interface IMap<T> {
    [key: string]: T;
}

export async function delay(ms: number) {
    return new Promise<void>((resolve) => {
        const timer = globalThis.setTimeout;
        if (typeof timer === "function") {
            timer(resolve, ms);
            return;
        }
        resolve();
    });
}

export class CancellationToken {
    public isCancelled: boolean = false;
}
