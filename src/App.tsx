import { useEffect, useRef } from 'react';
import { Game } from './game';
import { Hud } from './ui/Hud';
import { RequestCard } from './ui/Request';
import { ResultScreen } from './ui/Result';
import { DebugPanel } from './ui/Debug';
import { StartOverlay } from './ui/Start';

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const game = new Game(canvasRef.current);
    gameRef.current = game;
    // デバッグ用に外から触れるようにしておく（コンソールから CONFIG 変更後の確認など）
    (window as unknown as { __HS: unknown }).__HS = game;
    return () => {
      game.dispose();
      gameRef.current = null;
    };
  }, []);

  return (
    <div className="app">
      <canvas
        ref={canvasRef}
        className="viewport"
        onClick={() => gameRef.current?.requestLock()}
      />
      <div className="vignette" />
      <Hud />
      <RequestCard />
      <DebugPanel />
      <StartOverlay onStart={(mode) => gameRef.current?.startRun(mode)} />
      <ResultScreen
        onRestart={() => gameRef.current?.restart()}
        onMenu={() => gameRef.current?.returnToMenu()}
        onDownload={(kind) => gameRef.current?.logger.download(kind)}
      />
    </div>
  );
}
