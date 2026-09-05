/**
 * 実行中のコードのビルドID。
 *
 * v1.2 の実装中、HMR が古いモジュールを配っていたせいで
 * 「ソースは正しいのにテストが 0% を返す」を長時間追いかけた。
 * 異常な結果を見たら、まず実行中のコードが最新かを疑えるようにしておく。
 */
export const BUILD_ID: string =
  typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'unknown';
