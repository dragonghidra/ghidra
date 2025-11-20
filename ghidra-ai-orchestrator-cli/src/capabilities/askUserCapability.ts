import type { CapabilityModule, CapabilityContribution, CapabilityContext } from '../runtime/agentHost.js';
import readline from 'node:readline';
import { stdin, stdout } from 'node:process';

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

export interface AskUserResponse {
  answers: Record<string, string | string[]>;
}

export class AskUserCapability implements CapabilityModule {
  id = 'capability.ask_user';
  description = 'Interactive questioning during execution';

  async create(_context: CapabilityContext): Promise<CapabilityContribution> {
    return {
      id: 'ask_user.tools',
      description: 'Ask user questions during execution',
      toolSuite: {
        id: 'ask_user',
        tools: [
          {
            name: 'ask_user_question',
            description: `Ask the user questions during execution to gather preferences, clarify ambiguous instructions, get decisions on implementation choices, or offer choices.

Usage notes:
- Users can always select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers
- Provide 2-4 clear, mutually exclusive options (unless multiSelect enabled)
- Each option should have a concise label (1-5 words) and helpful description

Examples:
- Clarifying feature requirements: "Which authentication method should we use?"
- Getting implementation preferences: "How should we handle errors?"
- Offering technical choices: "Which testing framework should we use?"`,
            parameters: {
              type: 'object',
              properties: {
                questions: {
                  type: 'array',
                  description: 'Questions to ask the user (1-4 questions)',
                  items: {
                    type: 'object',
                    properties: {
                      question: {
                        type: 'string',
                        description: 'The complete question to ask. Should end with a question mark.',
                      },
                      header: {
                        type: 'string',
                        description: 'Very short label (max 12 chars). Examples: "Auth method", "Library", "Approach"',
                      },
                      options: {
                        type: 'array',
                        description: 'Available choices (2-4 options)',
                        items: {
                          type: 'object',
                          properties: {
                            label: {
                              type: 'string',
                              description: 'Display text (1-5 words)',
                            },
                            description: {
                              type: 'string',
                              description: 'Explanation of this option and its implications',
                            },
                          },
                          required: ['label', 'description'],
                        },
                      },
                      multiSelect: {
                        type: 'boolean',
                        description: 'Allow multiple selections',
                      },
                    },
                    required: ['question', 'header', 'options', 'multiSelect'],
                  },
                },
              },
              required: ['questions'],
            },
            handler: async (args) => {
              const { questions } = args as { questions: Question[] };

              if (!Array.isArray(questions) || questions.length === 0) {
                return JSON.stringify({ error: 'No questions provided' });
              }

              const answers: Record<string, string | string[]> = {};

              for (const question of questions) {
                const answer = await this.askQuestion(question);
                answers[question.header] = answer;
              }

              return JSON.stringify({ answers });
            },
          },
        ],
      },
    };
  }

  private async askQuestion(question: Question): Promise<string | string[]> {
    console.log(`\n${question.question}`);
    console.log(`\nOptions:`);

    question.options.forEach((option, index) => {
      console.log(`${index + 1}. ${option.label}`);
      console.log(`   ${option.description}`);
    });

    console.log(`${question.options.length + 1}. Other (provide custom input)`);

    if (question.multiSelect) {
      console.log(`\nEnter numbers separated by commas (e.g., "1,3") or type "other":`);
    } else {
      console.log(`\nEnter the number of your choice or type "other":`);
    }

    const rl = readline.createInterface({
      input: stdin,
      output: stdout,
    });

    return new Promise((resolve) => {
      rl.question('> ', (input) => {
        rl.close();

        const trimmed = input.trim().toLowerCase();

        if (trimmed === 'other' || trimmed === String(question.options.length + 1)) {
          const customRl = readline.createInterface({
            input: stdin,
            output: stdout,
          });
          console.log('Enter your custom answer:');
          customRl.question('> ', (customInput) => {
            customRl.close();
            resolve(customInput.trim());
          });
          return;
        }

        if (question.multiSelect) {
          const choices = trimmed.split(',').map((s) => s.trim());
          const selected: string[] = [];

          for (const choice of choices) {
            const index = Number.parseInt(choice, 10);
            if (Number.isFinite(index) && index >= 1 && index <= question.options.length) {
              selected.push(question.options[index - 1]!.label);
            }
          }

          if (selected.length > 0) {
            resolve(selected);
          } else {
            console.log('Invalid selection, using first option as default');
            resolve([question.options[0]!.label]);
          }
        } else {
          const choice = Number.parseInt(trimmed, 10);
          if (Number.isFinite(choice) && choice >= 1 && choice <= question.options.length) {
            resolve(question.options[choice - 1]!.label);
          } else {
            console.log('Invalid choice, using first option as default');
            resolve(question.options[0]!.label);
          }
        }
      });
    });
  }
}
