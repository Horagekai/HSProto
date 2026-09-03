import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const el = document.getElementById('root');
if (!el) throw new Error('#root not found');

// StrictModeは使わない: 開発時にeffectが2回走るとWebGLコンテキストを作り直すことになる
createRoot(el).render(<App />);
