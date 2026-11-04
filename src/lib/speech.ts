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
  const wanted = useRef(false); // el usuario quiere seguir dictando
  const last = useRef(''); // última frase entregada, para descartar repeticiones

  const stop = useCallback(() => {
    wanted.current = false;
    rec.current?.stop();
  }, []);

  /** Entrega la frase solo si no repite (o prolonga) lo ya entregado: Chrome en Android a veces re-emite resultados. */
  const deliver = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    const prev = last.current;
    const norm = (x: string) => x.toLowerCase().replace(/\s+/g, ' ').trim();
    if (prev && norm(t) === norm(prev)) return;
    let out = t;
    if (prev && norm(t).startsWith(norm(prev) + ' ')) out = t.slice(prev.length).trim();
    if (!out) return;
    last.current = t;
    cb.current(out);
  };

  const begin = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = 'es-AR';
    // Una frase por sesión y reinicio automático: evita el texto duplicado del modo continuo en Android.
    r.continuous = false;
    r.interimResults = true;
    r.onresult = (e) => {
      let live = '';
      let finalText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += (finalText ? ' ' : '') + res[0].transcript;
        else live += res[0].transcript;
      }
      if (finalText) deliver(finalText);
      setInterim(live);
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech' && wanted.current) return; // silencio: seguimos escuchando
      wanted.current = false;
      setError(ERRORS[e.error] ?? `Error de dictado: ${e.error}`);
    };
    r.onend = () => {
      setInterim('');
      if (wanted.current) {
        setTimeout(() => {
          if (wanted.current) begin();
        }, 150);
      } else {
        setListening(false);
      }
    };
    rec.current = r;
    try {
      r.start();
    } catch {
      wanted.current = false;
      setListening(false);
      setError('No se pudo iniciar el dictado.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(() => {
    if (!getCtor()) return;
    setError(null);
    last.current = '';
    wanted.current = true;
    setListening(true);
    begin();
  }, [begin]);

  useEffect(
    () => () => {
      wanted.current = false;
      rec.current?.stop();
    },
    [],
  );
  return { supported, listening, interim, error, start, stop };
}
