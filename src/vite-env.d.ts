/// <reference types="vite/client" />

declare module "aabb-3d" {
  export default class AABB {
    base: number[];
    max: number[];
    constructor(pos: number[], size: number[]);
    translate(by: number[]): this;
  }
}

declare module "voxel-aabb-sweep" {
  type SweepCallback = (dist: number, axis: number, dir: number, remaining: number[]) => boolean | void;
  export default function sweep(
    getVoxel: (x: number, y: number, z: number) => unknown,
    box: { base: number[]; max: number[]; translate(by: number[]): unknown },
    vector: number[],
    callback: SweepCallback,
    noTranslate?: boolean,
    epsilon?: number
  ): number;
}
