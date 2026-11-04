import { useCallback, useEffect, useRef, useState } from 'react';

/** Tipos mínimos de la Web Speech API (no vienen en lib.dom de todas las versiones de TypeScript). */
interface SpeechAlt { transcript: string }
interface SpeechRes { isFinal: boolean; 0: SpeechAlt }
interface SpeechEvent { resultIndex: number; results: ArrayLike<SpeechRes> }
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'No diste permiso para usar el micrófono. Habilitalo en el navegador.',
  'service-not-allowed': 'El navegador no permite el dictado en este contexto.',
  'no-speech': 'No se escuchó nada. Probá de nuevo.',
  'audio-capture': 'No se encontró un micrófono.',
  network: 'El dictado necesita conexión a internet (lo procesa el navegador).',
};

/**
 * Dictado por voz del navegador (es-AR). Cada frase final se entrega a `onFinal`.
 * Nota de privacidad: en Chrome/Edge el audio lo procesa el servicio de voz del navegador (Google/Microsoft).
 */
export function useSpeech(onFinal: (text: string) => void) {
  const supported = typeof window !== 'undefined' && getCtor() !== null;
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const cb = useRef(onFinal);
  cb.current = onFinal;

  const stop = useCallback(() => rec.current?.stop(), []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) return;
    setError(null);
    const r = new Ctor();
    r.lang = 'es-AR';
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) cb.current(res[0].transcript.trim());
        else live += res[0].transcript;
      }
      setInterim(live);
    };
    r.onerror = (e) => setError(ERRORS[e.error] ?? `Error de dictado: ${e.error}`);
    r.onend = () => {
      setListening(false);
      setInterim('');
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setError('No se pudo iniciar el dictado.');
    }
  }, []);

  useEffect(() => () => rec.current?.stop(), []);
  return { supported, listening, interim, error, start, stop };
}
