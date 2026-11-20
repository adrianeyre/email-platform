import {
  createButtonBlock,
  createColumnsBlock,
  createDesign,
  createDividerBlock,
  createImageBlock,
  createSpacerBlock,
  createTextBlock,
  spacing,
  type Design,
} from "../../templates/design/model.js";

export interface Starter {
  id: string;
  name: string;
  description: string;
  subject: string;
  variables: string;
  sampleVariables: Record<string, unknown>;
  design: () => Design;
}

export const starters: readonly Starter[] = [
  {
    id: "blank",
    name: "Blank",
    description: "An empty email to build from scratch.",
    subject: "",
    variables: "",
    sampleVariables: {},
    design: () => createDesign([createTextBlock("<p></p>")]),
  },
  {
    id: "simple",
    name: "Simple message",
    description: "A heading, a paragraph and a button.",
    subject: "Hello {{name}}",
    variables: "name, actionUrl",
    sampleVariables: { name: "Ada", actionUrl: "https://example.com" },
    design: () =>
      createDesign([
        createTextBlock("<h1>Hello {{name}}</h1>"),
        createTextBlock(
          "<p>Thanks for signing up. Everything is ready for you, so the next step is just one click away.</p>",
        ),
        createButtonBlock("Get started", "{{actionUrl}}"),
        createTextBlock(
          '<p><span style="color: #6b7280; font-size: 14px">If you have any questions, just reply to this email.</span></p>',
        ),
      ]),
  },
  {
    id: "newsletter",
    name: "Newsletter",
    description: "A banner, an intro, two columns of stories and a footer.",
    subject: "What's new this month",
    variables: "name",
    sampleVariables: { name: "Ada" },
    design: () => {
      const columns = createColumnsBlock(2);
      columns.columns = columns.columns.map((column, index) => ({
        ...column,
        blocks: [
          {
            ...createTextBlock(
              `<h3>Story ${String(index + 1)}</h3><p>A short summary that makes people want to read more.</p>`,
            ),
            padding: spacing(0),
          },
          {
            ...createButtonBlock("Read more", "https://example.com"),
            padding: spacing(8, 0),
            align: "left",
            fontSize: 14,
            innerPaddingX: 18,
            innerPaddingY: 10,
          },
        ],
      }));
      const design = createDesign([
        {
          ...createTextBlock(
            '<h1 style="text-align: center"><span style="color: #ffffff">Monthly update</span></h1><p style="text-align: center"><span style="color: #dbeafe">News, ideas and what we have been building</span></p>',
          ),
          padding: spacing(0),
          backgroundColor: "#1d4ed8",
          boxPadding: 32,
        },
        createSpacerBlock(16),
        createTextBlock(
          "<p>Hi {{name}},</p><p>Here is a quick round-up of everything that happened this month.</p>",
        ),
        createImageBlock(),
        columns,
        createDividerBlock(),
        createTextBlock(
          '<p style="text-align: center"><span style="color: #6b7280; font-size: 13px">You are receiving this because you signed up for updates.</span></p>',
        ),
      ]);
      return design;
    },
  },
];
