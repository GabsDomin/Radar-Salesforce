// Executa a atualização em segundo plano para o painel (uma por vez) e guarda o andamento.
import type { DB } from '../db/index.ts';
import { atualizar, STEP_LABEL, type StepId } from '../pipeline/update.ts';

export interface UpdateState {
  running: boolean;
  step: StepId | null;
  stepLabel: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  log: string[];
  results: { step: StepId; ok: boolean; error?: string }[];
}

const MAX_LOG_LINES = 500;
const VALID: StepId[] = ['vagas', 'noticias', 'enriquecer', 'tecnologia', 'site', 'publicar'];

export class UpdateRunner {
  state: UpdateState = { running: false, step: null, stepLabel: null, startedAt: null, finishedAt: null, log: [], results: [] };

  private db: DB;
  private newsLimit: number;

  constructor(db: DB, newsLimit = 30) {
    this.db = db;
    this.newsLimit = newsLimit;
  }

  get limit() { return this.newsLimit; }

  // Retorna false se já há uma atualização em andamento ou nenhuma etapa válida foi pedida.
  start(requested: string[]): boolean {
    const steps = VALID.filter((s) => requested.includes(s));
    if (this.state.running || !steps.length) return false;
    this.state = { running: true, step: null, stepLabel: null, startedAt: new Date().toISOString(), finishedAt: null, log: [], results: [] };
    const log = (m: string) => {
      this.state.log.push(m);
      if (this.state.log.length > MAX_LOG_LINES) this.state.log.splice(0, this.state.log.length - MAX_LOG_LINES);
    };
    void atualizar(this.db, {
      steps, newsLimit: this.newsLimit,
      onStep: (s) => { this.state.step = s; this.state.stepLabel = STEP_LABEL[s]; },
    }, log)
      .then((results) => { this.state.results = results; })
      .catch((err) => log(`✖ erro inesperado: ${err instanceof Error ? err.message : err}`))
      .finally(() => {
        this.state.running = false;
        this.state.step = null;
        this.state.stepLabel = null;
        this.state.finishedAt = new Date().toISOString();
      });
    return true;
  }
}
