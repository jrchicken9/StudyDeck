export type ExamSummary = {
  id: string;
  title: string;
  subtitle: string;
  /** Short blurb for dashboard cards */
  description: string;
  /** Link label on the dashboard exam card */
  dashboardCta: string;
};

export const EXAMS: ExamSummary[] = [
  {
    id: "sgt-march-2026",
    title: "Sergeant exam",
    subtitle: "March 2026",
    description: "Full bank of multiple-choice items with instant feedback.",
    dashboardCta: "Get Started",
  },
];

export function getExamSummary(id: string): ExamSummary | undefined {
  return EXAMS.find((e) => e.id === id);
}
