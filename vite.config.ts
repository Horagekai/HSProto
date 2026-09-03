import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
  // PORT が渡されていればそれを使う（開発ツールからの起動用）
  server: { port: Number(process.env.PORT) || 5173 },
});
