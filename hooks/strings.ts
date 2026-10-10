export type Lang = 'en' | 'fr'

const STRINGS = {
  en: {
    active: (n: number) => `${n} active`,
    done: (n: number) => `${n} done`,
    tools: (n: number) => `${n} tool${n === 1 ? '' : 's'}`,
    toolCalls: (n: number) => `${n} tool call${n === 1 ? '' : 's'}`,
    more: (n: number) => `+${n} more · /flotilla side to see all`,
    idleFor: (d: string) => `⚠ no activity for ${d}`,
    starting: 'starting…',
    thinking: 'thinking…',
    waitingOn: '◌ waiting on its background work',
    agents: (n: number) => `${n} agent${n === 1 ? '' : 's'}`,
    waiting: (n: number) => `${n} waiting`,
    empty: 'No agents yet. They show up here as soon as one starts.',
    ago: (d: string) => `${d} ago`,
    now: 'now',
    list: 'List',
    timeline: 'Timeline',
    pane: 'Side pane',
    above: 'Above prompt',
    collapse: 'Collapse',
    expand: 'Expand',
    hideDone: 'Hide done',
    showDone: 'Show done',
    clear: 'Clear',
    noneRunning: 'Nothing is running right now. Flotilla shows up as soon as an agent or a background task starts.',
    tasks: (n: number) => `${n} task${n === 1 ? '' : 's'}`,
    idleLine: 'Flotilla is on · nothing running',
    ended: (status: string) => ({ completed: 'done', failed: 'failed', killed: 'stopped' })[status] ?? status,
  },
  fr: {
    active: (n: number) => `${n} actif${n > 1 ? 's' : ''}`,
    done: (n: number) => `${n} terminé${n > 1 ? 's' : ''}`,
    tools: (n: number) => `${n} outil${n > 1 ? 's' : ''}`,
    toolCalls: (n: number) => `${n} appel${n > 1 ? 's' : ''} d'outils`,
    more: (n: number) => `+${n} autre${n > 1 ? 's' : ''} · /flotilla side pour tout voir`,
    idleFor: (d: string) => `⚠ aucune activité depuis ${d}`,
    starting: 'démarrage…',
    thinking: 'réfléchit…',
    waitingOn: '◌ attend son travail en arrière-plan',
    agents: (n: number) => `${n} agent${n > 1 ? 's' : ''}`,
    waiting: (n: number) => `${n} en attente`,
    empty: "Aucun agent en cours. Ils apparaissent ici dès qu'un agent démarre.",
    ago: (d: string) => `il y a ${d}`,
    now: 'maintenant',
    list: 'Liste',
    timeline: 'Chronologie',
    pane: 'Panneau',
    above: 'Au-dessus du prompt',
    collapse: 'Réduire',
    expand: 'Agrandir',
    hideDone: 'Masquer terminés',
    showDone: 'Afficher terminés',
    clear: 'Vider',
    noneRunning: "Rien ne tourne pour l'instant. Flotilla apparaît dès qu'un agent ou une tâche en arrière-plan démarre.",
    tasks: (n: number) => `${n} tâche${n > 1 ? 's' : ''}`,
    idleLine: 'Flotilla est actif · rien ne tourne',
    ended: (status: string) => ({ completed: 'terminée', failed: 'échouée', killed: 'arrêtée' })[status] ?? status,
  },
}

/** The words every drawing uses; set from the `language` option, or detected. */
export let t: (typeof STRINGS)[Lang] = STRINGS.en

export function setLang(lang: Lang) {
  t = STRINGS[lang]
}

export const asLang = (value: unknown): Lang | undefined =>
  typeof value !== 'string' ? undefined : /^(fr|french|fran[cç]ais)/i.test(value) ? 'fr' : /^(en|english)/i.test(value) ? 'en' : undefined
