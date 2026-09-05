/// <reference types="vite/client" />

/**
 * ビルド時に vite.config.ts が埋め込む。git の短縮SHA + ビルド時刻。
 * 実行中のコードがどのビルドなのかを、ゲームの中から確認するために使う。
 */
declare const __BUILD_ID__: string;
