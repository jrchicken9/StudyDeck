export type Question = {
  id: string;
  text: string;
  choices: [string, string, string];
  correctIndex: number | null;
};

export type Exam = {
  examId: string;
  title: string;
  version: number;
  sourceNote?: string;
  questions: Question[];
};
