export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/**
 * 部屋矩形の集合をセル占有グリッドに変換したもの。
 * - 壁メッシュの生成
 * - 円形コライダーの衝突解決
 * - 視線(LOS)判定
 * - プレイヤーへ向かうフローフィールド(BFS)
 * をすべてこの1クラスで賄う。
 */
export class Grid {
  readonly cell: number;
  readonly minX: number;
  readonly minZ: number;
  readonly w: number;
  readonly h: number;
  readonly open: Uint8Array;
  /**
   * 経路探索用の「余裕のあるセル」。
   * 開いていて、かつ8近傍もすべて開いているセルだけを通路として扱う。
   * これをやらないと、半径0.35の円が通れない壁際をフローフィールドが指してしまい、
   * プレイヤーも怪異も出入口の角に引っかかる。
   */
  readonly navOpen: Uint8Array;
  private dist: Int32Array;

  constructor(rects: Rect[], cell = 0.5, pad = 2, blockers: Rect[] = []) {
    this.cell = cell;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const r of rects) {
      minX = Math.min(minX, r.x0);
      maxX = Math.max(maxX, r.x1);
      minZ = Math.min(minZ, r.z0);
      maxZ = Math.max(maxZ, r.z1);
    }
    this.minX = minX - pad * cell;
    this.minZ = minZ - pad * cell;
    this.w = Math.ceil((maxX - minX) / cell) + pad * 2;
    this.h = Math.ceil((maxZ - minZ) / cell) + pad * 2;
    this.open = new Uint8Array(this.w * this.h);
    for (let iz = 0; iz < this.h; iz++) {
      for (let ix = 0; ix < this.w; ix++) {
        const x = this.minX + (ix + 0.5) * cell;
        const z = this.minZ + (iz + 0.5) * cell;
        let inside = 0;
        for (const r of rects) {
          if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) {
            inside = 1;
            break;
          }
        }
        // 部屋の内側でも、blockerに含まれるセルは壁にする（出入口を絞るため）
        if (inside) {
          for (const b of blockers) {
            if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) {
              inside = 0;
              break;
            }
          }
        }
        this.open[iz * this.w + ix] = inside;
      }
    }
    this.navOpen = new Uint8Array(this.w * this.h);
    for (let iz = 0; iz < this.h; iz++) {
      for (let ix = 0; ix < this.w; ix++) {
        let ok = this.isOpenCell(ix, iz);
        if (ok) {
          for (let oz = -1; oz <= 1 && ok; oz++) {
            for (let ox = -1; ox <= 1 && ok; ox++) {
              if (!this.isOpenCell(ix + ox, iz + oz)) ok = false;
            }
          }
        }
        this.navOpen[iz * this.w + ix] = ok ? 1 : 0;
      }
    }
    this.dist = new Int32Array(this.w * this.h);
  }

  ix(x: number) {
    return Math.floor((x - this.minX) / this.cell);
  }
  iz(z: number) {
    return Math.floor((z - this.minZ) / this.cell);
  }
  cellX(ix: number) {
    return this.minX + (ix + 0.5) * this.cell;
  }
  cellZ(iz: number) {
    return this.minZ + (iz + 0.5) * this.cell;
  }
  isOpenCell(ix: number, iz: number) {
    if (ix < 0 || iz < 0 || ix >= this.w || iz >= this.h) return false;
    return this.open[iz * this.w + ix] === 1;
  }
  isOpenWorld(x: number, z: number) {
    return this.isOpenCell(this.ix(x), this.iz(z));
  }

  /** 描画対象になる壁セル（開いたセルに隣接するブロックセル） */
  wallCells(): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (let iz = 0; iz < this.h; iz++) {
      for (let ix = 0; ix < this.w; ix++) {
        if (this.isOpenCell(ix, iz)) continue;
        if (
          this.isOpenCell(ix + 1, iz) ||
          this.isOpenCell(ix - 1, iz) ||
          this.isOpenCell(ix, iz + 1) ||
          this.isOpenCell(ix, iz - 1) ||
          this.isOpenCell(ix + 1, iz + 1) ||
          this.isOpenCell(ix - 1, iz - 1) ||
          this.isOpenCell(ix + 1, iz - 1) ||
          this.isOpenCell(ix - 1, iz + 1)
        ) {
          out.push([ix, iz]);
        }
      }
    }
    return out;
  }

  /** 軸ごとに押し戻す円 vs グリッドの衝突解決 */
  moveCircle(x: number, z: number, dx: number, dz: number, r: number): { x: number; z: number } {
    let nx = x + dx;
    let nz = z;
    nx = this.resolveAxis(nx, nz, r, true, dx);
    nz = z + dz;
    nz = this.resolveAxis(nx, nz, r, false, dz);
    return { x: nx, z: nz };
  }

  private resolveAxis(x: number, z: number, r: number, axisX: boolean, delta: number): number {
    if (delta === 0) return axisX ? x : z;
    const ix0 = this.ix(x - r);
    const ix1 = this.ix(x + r);
    const iz0 = this.iz(z - r);
    const iz1 = this.iz(z + r);
    let px = x;
    let pz = z;
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        if (this.isOpenCell(ix, iz)) continue;
        const cx0 = this.minX + ix * this.cell;
        const cx1 = cx0 + this.cell;
        const cz0 = this.minZ + iz * this.cell;
        const cz1 = cz0 + this.cell;
        if (px + r <= cx0 || px - r >= cx1 || pz + r <= cz0 || pz - r >= cz1) continue;
        if (axisX) {
          px = delta > 0 ? cx0 - r - 0.001 : cx1 + r + 0.001;
        } else {
          pz = delta > 0 ? cz0 - r - 0.001 : cz1 + r + 0.001;
        }
      }
    }
    return axisX ? px : pz;
  }

  /** 2点間に壁がないか（高さは無視する簡易判定） */
  losClear(ax: number, az: number, bx: number, bz: number): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    const steps = Math.ceil(len / (this.cell * 0.5));
    if (steps === 0) return true;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (!this.isOpenWorld(ax + dx * t, az + dz * t)) return false;
    }
    return true;
  }

  /**
   * 目標地点からの距離場（重み付き）。
   *
   * 「開いているセル」はすべて辿るので必ず下り勾配が存在する。
   * ただし navOpen でないセル（壁際で円が収まらない場所）は通過コストを高くしてあるので、
   * 経路は自然と通路の中央、出入口の真ん中を通る。
   * これをやらないと、最短経路が出入口の角をかすめてプレイヤーが引っかかる。
   */
  computeFlow(tx: number, tz: number) {
    const { w, h } = this;
    this.dist.fill(-1);
    const start = this.iz(tz) * w + this.ix(tx);
    if (start < 0 || start >= this.dist.length || this.open[start] !== 1) return;

    const NAV_COST = 1;
    const TIGHT_COST = 6;
    const buckets: number[][] = [];
    const push = (index: number, d: number) => {
      (buckets[d] ??= []).push(index);
    };
    this.dist[start] = 0;
    push(start, 0);

    for (let d = 0; d < buckets.length; d++) {
      const bucket = buckets[d];
      if (!bucket) continue;
      for (const cur of bucket) {
        if (this.dist[cur] !== d) continue; // すでに短い経路が見つかっている
        const cx = cur % w;
        const cz = (cur - cx) / w;
        for (let k = 0; k < 4; k++) {
          const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0);
          const nz = cz + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
          const ni = nz * w + nx;
          if (this.open[ni] !== 1) continue;
          const nd = d + (this.navOpen[ni] === 1 ? NAV_COST : TIGHT_COST);
          if (this.dist[ni] >= 0 && this.dist[ni] <= nd) continue;
          this.dist[ni] = nd;
          push(ni, nd);
        }
      }
    }
  }

  /** 距離場に沿って進むべき方向（正規化済み）。見つからなければnull */
  flowDir(x: number, z: number): { x: number; z: number } | null {
    const ix = this.ix(x);
    const iz = this.iz(z);
    if (!this.isOpenCell(ix, iz)) return null;
    const here = this.dist[iz * this.w + ix];

    let best = -1;
    let bx = 0;
    let bz = 0;
    for (let oz = -1; oz <= 1; oz++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oz === 0) continue;
        const nx = ix + ox;
        const nz = iz + oz;
        if (!this.isOpenCell(nx, nz)) continue;
        // 斜めは両隣が開いているときだけ許可（角抜け防止）
        if (ox !== 0 && oz !== 0 && (!this.isOpenCell(ix + ox, iz) || !this.isOpenCell(ix, iz + oz)))
          continue;
        const d = this.dist[nz * this.w + nx];
        if (d < 0 || (here >= 0 && d >= here)) continue;
        if (best < 0 || d < best) {
          best = d;
          bx = this.cellX(nx) - x;
          bz = this.cellZ(nz) - z;
        }
      }
    }
    if (best < 0) return null;
    const len = Math.hypot(bx, bz) || 1;
    return { x: bx / len, z: bz / len };
  }
}
