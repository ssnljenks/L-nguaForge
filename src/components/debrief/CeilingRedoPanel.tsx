import React, {useEffect, useState} from 'react';
import {CheckCircle2, Loader2, Mic, MicOff, RotateCcw, Send, Volume2, X} from 'lucide-react';
import type {AppendErrorEventsFn, CeilingMoment, OpiRedoRecord, OpiSession} from '../../types';
import {getDialectInfo, LANGUAGE_LABELS} from '../../utils/ilrLogic';
import {gradeOpiRedoTurn} from '../../services/api';
import {useSpeechRecognition, useSpeechSynthesis} from '../../hooks/useSpeech';

interface CeilingRedoPanelProps {
  session: OpiSession;
  ceiling: CeilingMoment;
  existingRedo?: OpiRedoRecord;
  onSaveRedo: (sessionId: string, record: OpiRedoRecord) => void;
  onAppendErrorEvents?: AppendErrorEventsFn;
  onClose: () => void;
}

/**
 * Focused single-turn redo flow: re-asks the exact examiner prompt where breakdown occurred,
 * captures one spoken or typed answer, and grades it against the original utterance via /api/opi/redo-turn.
 */
export const CeilingRedoPanel: React.FC<CeilingRedoPanelProps> = ({
  session,
  ceiling,
  existingRedo,
  onSaveRedo,
  onAppendErrorEvents,
  onClose,
}) => {
  const dialectInfo = getDialectInfo(session.language, session.dialect);
  const tts = useSpeechSynthesis();
  const stt = useSpeechRecognition();

  const [redoText, setRedoText] = useState(existingRedo?.redoAnswer ?? '');
  const [isGrading, setIsGrading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [record, setRecord] = useState<OpiRedoRecord | null>(existingRedo ?? null);

  useEffect(() => {
    const combined = `${stt.finalTranscript} ${stt.interimTranscript}`.trim();
    if (combined && stt.isListening) {
      setRedoText(combined);
    }
  }, [stt.finalTranscript, stt.interimTranscript, stt.isListening]);

  const handleListenPrompt = () => {
    tts.speak(ceiling.examinerPrompt, {
      lang: dialectInfo.bcp47,
      rate: 1.0,
    });
  };

  const handleToggleMic = () => {
    if (stt.isListening) {
      stt.stopListening();
    } else {
      tts.stop();
      stt.resetTranscript();
      stt.startListening({lang: dialectInfo.bcp47, continuous: true});
    }
  };

  const handleSubmitRedo = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = redoText.trim();
    if (!clean || isGrading) return;
    stt.stopListening();
    tts.stop();
    setIsGrading(true);
    setError(null);
    try {
      const evaluation = await gradeOpiRedoTurn({
        language: session.language,
        dialect: session.dialect,
        examinerPrompt: ceiling.examinerPrompt,
        originalAnswer: ceiling.candidateUtterance,
        redoAnswer: clean,
        failedFunction: ceiling.failedFunction,
      });
      const nextRecord: OpiRedoRecord = {
        examinerPrompt: ceiling.examinerPrompt,
        redoAnswer: clean,
        evaluation,
        completedAt: new Date().toISOString(),
      };
      setRecord(nextRecord);
      onSaveRedo(session.id, nextRecord);
      if (evaluation.errors && evaluation.errors.length > 0) {
        onAppendErrorEvents?.(
          evaluation.errors.map((errItem) => ({
            key: errItem.key,
            source: 'redo',
            sessionId: session.id,
            wrong: errItem.wrong,
            fix: errItem.fix,
            quote: errItem.quote,
            language: session.language,
          }))
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to grade redo answer.');
    } finally {
      setIsGrading(false);
    }
  };

  return (
    <div
      data-testid="ceiling-redo-panel"
      className="rounded-xl border border-[#7DD3FC]/40 bg-[#0D151F] p-4 sm:p-5 space-y-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-[#7DD3FC]">
            Single-Turn Redo · Target: {ceiling.failedFunctionLabel}
          </p>
          <h3 className="text-base font-semibold text-[#F8FAFC] mt-0.5">Answer this examiner prompt again</h3>
        </div>
        <button
          type="button"
          onClick={() => {
            tts.stop();
            stt.stopListening();
            onClose();
          }}
          aria-label="Close redo panel"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-[#94A3B8] hover:text-white"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Re-asked Examiner Prompt */}
      <div className="rounded-lg border border-[#23303E] bg-[#111922] p-3.5 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-[#94A3B8]">Examiner prompt</span>
          <button
            type="button"
            onClick={handleListenPrompt}
            className="inline-flex items-center gap-1.5 min-h-[36px] px-2.5 rounded-lg border border-[#23303E] bg-[#0B1117] text-xs font-medium text-[#CBD5E1] hover:text-white transition-colors"
          >
            <Volume2 className="w-3.5 h-3.5 text-[#D99B26]" />
            <span>Play prompt</span>
          </button>
        </div>
        <p className="text-sm text-[#F1F5F9] leading-relaxed">&ldquo;{ceiling.examinerPrompt}&rdquo;</p>
      </div>

      {/* Record or Type New Answer */}
      <form onSubmit={handleSubmitRedo} className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="redo-answer-textarea" className="text-xs font-medium text-[#CBD5E1]">
            Your new {LANGUAGE_LABELS[session.language]} answer
          </label>
          <button
            type="button"
            onClick={handleToggleMic}
            className={`inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg border text-xs font-medium transition-colors ${
              stt.isListening
                ? 'border-red-500 bg-red-600 text-white'
                : 'border-[#2E4054] bg-[#111922] text-[#E6EDF3] hover:bg-[#182330]'
            }`}
          >
            {stt.isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5 text-[#D99B26]" />}
            <span>{stt.isListening ? 'Stop recording' : 'Record answer'}</span>
          </button>
        </div>

        <textarea
          id="redo-answer-textarea"
          rows={3}
          value={redoText}
          onChange={(e) => setRedoText(e.target.value)}
          placeholder={`Speak or type an improved ${LANGUAGE_LABELS[session.language]} response targeting ${ceiling.failedFunctionLabel.toLowerCase()}…`}
          className="w-full rounded-xl border border-[#23303E] bg-[#111922] px-3.5 py-2.5 text-sm text-[#E6EDF3] placeholder:text-[#64748B] focus:outline-none focus:border-[#D99B26]"
        />

        {stt.error && <p className="text-xs text-amber-300">{stt.error}</p>}
        {error && (
          <p role="alert" className="text-xs text-[#F87171]">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="submit"
            disabled={!redoText.trim() || isGrading}
            data-testid="redo-submit-btn"
            className="inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] disabled:opacity-40 transition-colors"
          >
            {isGrading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            <span>{isGrading ? 'Grading comparison…' : record ? 'Re-grade Redo' : 'Grade Redo vs Original'}</span>
          </button>
        </div>
      </form>

      {/* Comparison Verdict */}
      {record && (
        <div
          data-testid="redo-evaluation-card"
          className="rounded-xl border border-[#23303E] bg-[#111922] p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {record.evaluation.improved ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <RotateCcw className="w-4 h-4 text-amber-300 shrink-0" />
              )}
              <span
                className={`text-sm font-semibold ${
                  record.evaluation.improved ? 'text-emerald-300' : 'text-amber-300'
                }`}
              >
                {record.evaluation.verdictLabel}
              </span>
            </div>
            <span className="text-[11px] text-[#94A3B8]">Practice estimate</span>
          </div>

          <p className="text-sm text-[#CBD5E1] leading-relaxed">{record.evaluation.comparisonSummary}</p>

          {record.evaluation.strengths.length > 0 && (
            <ul className="space-y-1 text-xs text-emerald-300/90">
              {record.evaluation.strengths.map((s) => (
                <li key={s}>• {s}</li>
              ))}
            </ul>
          )}

          {record.evaluation.remainingGap && (
            <p className="text-xs text-[#94A3B8]">
              <span className="font-semibold text-[#CBD5E1]">Next focus:</span> {record.evaluation.remainingGap}
            </p>
          )}

          {record.evaluation.upgradedModelAnswer && (
            <div className="pt-2.5 border-t border-[#23303E] space-y-1">
              <span className="text-[11px] font-medium text-[#7DD3FC]">Model ILR 2+/3 version</span>
              <p className="text-sm text-[#F8FAFC] leading-relaxed">
                &ldquo;{record.evaluation.upgradedModelAnswer}&rdquo;
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
