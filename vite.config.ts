import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 実行中のコードがどのビルドなのかを、ゲームの中から確認できるようにする。
 *
 * v1.2 の実装中に、HMR が古いモジュールを配っていたせいで
 * 「コードは正しいのにテストが 0% を返す」を長時間追いかけた。
 * 異常な結果が出たら、まず実行中のコードが最新かを疑えるようにしておく。
 */
function buildId() {
  let sha = 'nogit';
  try {
    sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    // git が無い環境でもビルドは通す
  }
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(2, 13);
  return `${sha}-${stamp}`;
}

export default defineConfig({
  plugins: [react()],
  /**
   * GitHub Pages は https://USER.github.io/REPO/ のようにサブディレクトリから配信される。
   *
   * 相対パス './' で出力しておけば、リポジトリ名が何であっても、
   * ルート配信でもサブディレクトリ配信でもアセットが 404 にならない。
   * （このプロジェクトは単一ページ・ルーター無し・外部アセット無しなので相対パスで完結する）
   *
   * 特定のパスに固定したい場合だけ、ビルド時に VITE_BASE を渡す。
   *   VITE_BASE=/haunted-streamer-mvp/ npm run build
   */
  base: process.env.VITE_BASE || './',
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
  // PORT が渡されていればそれを使う（開発ツールからの起動用）
  server: { port: Number(process.env.PORT) || 5173 },
});
