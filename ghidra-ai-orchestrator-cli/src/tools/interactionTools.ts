import type { ToolDefinition } from '../core/toolRuntime.js';
import * as readline from 'node:readline';

export interface QuestionOption {
  label: string;
  description: string;
}

export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

export function createInteractionTools(): ToolDefinition[] {
  return [
    {
      name: 'AskUserQuestion',
      description: `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take

Usage notes:
- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers to be selected for a question`,
      parameters: {
        type: 'object',
        properties: {
          questions: {
            description: 'Questions to ask the user (1-4 questions)',
            type: 'array',
            items: {
              type: 'object',
              properties: {
                question: {
                  type: 'string',
                  description:
                    'The complete question to ask the user. Should be clear, specific, and end with a question mark. Example: "Which library should we use for date formatting?" If multiSelect is true, phrase it accordingly, e.g. "Which features do you want to enable?"',
                },
                header: {
                  type: 'string',
                  description:
                    'Very short label displayed as a chip/tag (max 12 chars). Examples: "Auth method", "Library", "Approach".',
                },
                options: {
                  type: 'array',
                  description:
                    'The available choices for this question. Must have 2-4 options. Each option should be a distinct, mutually exclusive choice (unless multiSelect is enabled). There should be no "Other" option, that will be provided automatically.',
                  items: {
                    type: 'object',
                    properties: {
                      label: {
                        type: 'string',
                        description:
                          'The display text for this option that the user will see and select. Should be concise (1-5 words) and clearly describe the choice.',
                      },
                      description: {
                        type: 'string',
                        description:
                          'Explanation of what this option means or what will happen if chosen. Useful for providing context about trade-offs or implications.',
                      },
                    },
                    required: ['label', 'description'],
                    additionalProperties: false,
                  },
                },
                multiSelect: {
                  type: 'boolean',
                  description:
                    'Set to true to allow the user to select multiple options instead of just one. Use when choices are not mutually exclusive.',
                },
              },
              required: ['question', 'header', 'options', 'multiSelect'],
              additionalProperties: false,
            },
          },
          answers: {
            type: 'object',
            description: 'User answers collected by the permission component',
          },
        },
        required: ['questions'],
      },
      handler: async (args: Record<string, unknown>) => {
        const questions = args['questions'] as Question[];
        const answers = args['answers'] as Record<string, string> | undefined;

        if (!questions || !Array.isArray(questions)) {
          return 'Error: questions parameter is required and must be an array.';
        }

        if (answers) {
          // Answers were already provided (e.g., by an interactive UI layer)
          let output = '📋 User Responses:\n\n';
          for (const [key, value] of Object.entries(answers)) {
            output += `${key}: ${value}\n`;
          }
          return output;
        }

        // Interactive mode - ask questions via terminal
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const userAnswers: Record<string, string> = {};

        try {
          for (let i = 0; i < questions.length; i++) {
            const q = questions[i];
            if (!q) continue;

            console.log(`\n[${q.header}] ${q.question}`);
            console.log('');

            q.options.forEach((opt, idx) => {
              console.log(`  ${idx + 1}. ${opt.label}`);
              console.log(`     ${opt.description}`);
            });

            console.log(`  ${q.options.length + 1}. Other (custom input)`);
            console.log('');

            const answer = await new Promise<string>((resolve) => {
              rl.question(
                q.multiSelect
                  ? `Select options (comma-separated numbers, e.g., "1,3"): `
                  : `Select an option (1-${q.options.length + 1}): `,
                (input) => {
                  resolve(input.trim());
                }
              );
            });

            if (q.multiSelect) {
              // Handle multi-select
              const selections = answer
                .split(',')
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
              const selectedOptions: string[] = [];

              for (const sel of selections) {
                const idx = parseInt(sel, 10);
                if (idx >= 1 && idx <= q.options.length) {
                  const option = q.options[idx - 1];
                  if (option) {
                    selectedOptions.push(option.label);
                  }
                } else if (idx === q.options.length + 1) {
                  const customAnswer = await new Promise<string>((resolve) => {
                    rl.question('Enter custom value: ', (input) => {
                      resolve(input.trim());
                    });
                  });
                  selectedOptions.push(customAnswer);
                }
              }

              userAnswers[q.header] = selectedOptions.join(', ');
            } else {
              // Handle single select
              const idx = parseInt(answer, 10);
              if (idx >= 1 && idx <= q.options.length) {
                const option = q.options[idx - 1];
                if (option) {
                  userAnswers[q.header] = option.label;
                } else {
                  userAnswers[q.header] = 'Invalid selection';
                }
              } else if (idx === q.options.length + 1) {
                const customAnswer = await new Promise<string>((resolve) => {
                  rl.question('Enter custom value: ', (input) => {
                    resolve(input.trim());
                  });
                });
                userAnswers[q.header] = customAnswer;
              } else {
                userAnswers[q.header] = 'Invalid selection';
              }
            }
          }

          let output = '\n📋 User Responses:\n\n';
          for (const [key, value] of Object.entries(userAnswers)) {
            output += `${key}: ${value}\n`;
          }

          return output;
        } finally {
          rl.close();
        }
      },
    },
  ];
}
