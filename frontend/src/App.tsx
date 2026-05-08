import { useEffect, useState, useRef } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { 
  useAgent, 
  UseAgentUpdate, 
  useHumanInTheLoop, 
  useConfigureSuggestions,
  CopilotSidebar,
} from "@copilotkit/react-core/v2";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import MarkdownIt from "markdown-it";
import { diffWords } from "diff";
import { z } from "zod";

import "@copilotkit/react-core/v2/styles.css";
import "./style.css";
import { VoiceAgentWidget } from "./components/VoiceAgentWidget";

const extensions = [StarterKit];

export default function App() {
  const chatTitle = "AI Document Editor";

  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      showDevConsole={true}
      agent="predictive_state_updates"
    >
      <div className="min-h-screen w-full flex flex-col">
        {/* Header */}
        <header className="app-header">
          <div className="logo-container">
            <div className="logo-icon">✎</div>
            <h1 className="app-title">Statecraft: AI Co-Editor</h1>
          </div>
          <div className="text-sm text-gray-500 font-medium">
            LangGraph + CopilotKit Predictive Streaming
          </div>
        </header>

        {/* Workspace Layout */}
        <div className="flex-1 flex flex-row relative">
          <main className="flex-1 p-6 overflow-y-auto">
            <DocumentEditor />
          </main>
          
          <CopilotSidebar
            agentId="predictive_state_updates"
            defaultOpen={true}
            labels={{
              modalHeaderTitle: chatTitle,
              chatInputPlaceholder: "Ask the AI to write or modify...",
            }}
          />
        </div>
      </div>
    </CopilotKit>
  );
}

interface AgentState {
  document: string;
}

const DocumentEditor = () => {
  const editor = useEditor({
    extensions,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "tiptap" },
    },
  });

  const [placeholderVisible, setPlaceholderVisible] = useState(false);
  const [currentDocument, setCurrentDocument] = useState("");

  // Set up suggestions for the user
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Write a pirate story",
        message: "Please write a short story about a pirate named Candy Beard.",
      },
      {
        title: "Write a mermaid story",
        message: "Please write a short story about a mermaid named Luna.",
      },
      { 
        title: "Add character", 
        message: "Please add a character named Courage the parrot to the story.",
      },
    ],
    available: "always",
  });

  const { agent } = useAgent({
    agentId: "predictive_state_updates",
    updates: [UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnRunStatusChanged],
  });

  const agentState = agent.state as AgentState | undefined;
  const setAgentState = (s: AgentState) => agent.setState(s);
  const isLoading = agent.isRunning;

  // Track when a run transitions from running to not running
  const wasRunning = useRef(false);

  useEffect(() => {
    if (isLoading) {
      setCurrentDocument(editor?.getText() || "");
    }
    editor?.setEditable(!isLoading);
  }, [isLoading, editor]);

  useEffect(() => {
    if (wasRunning.current && !isLoading) {
      // Run just finished - set the text one final time
      if (currentDocument.trim().length > 0 && currentDocument !== agentState?.document) {
        const newDocument = agentState?.document || "";
        const diff = diffPartialText(currentDocument, newDocument, true);
        const markdown = fromMarkdown(diff);
        editor?.commands.setContent(markdown);
      }
    }
    wasRunning.current = isLoading;
  }, [isLoading, agentState?.document, currentDocument, editor]);

  useEffect(() => {
    if (isLoading) {
      if (currentDocument.trim().length > 0) {
        const newDocument = agentState?.document || "";
        const diff = diffPartialText(currentDocument, newDocument);
        const markdown = fromMarkdown(diff);
        editor?.commands.setContent(markdown);
      } else {
        const markdown = fromMarkdown(agentState?.document || "");
        editor?.commands.setContent(markdown);
      }
    }
  }, [agentState?.document, isLoading, currentDocument, editor]);

  const text = editor?.getText() || "";

  useEffect(() => {
    setPlaceholderVisible(text.length === 0);

    if (!isLoading) {
      setCurrentDocument(text);
      setAgentState({
        document: text,
      });
    }
  }, [text, isLoading]);

  // Support confirm_changes tool call for backwards compatibility
  useHumanInTheLoop(
    {
      agentId: "predictive_state_updates",
      name: "confirm_changes",
      render: ({ args, respond, status }) => (
        <ConfirmChanges
          args={args}
          respond={respond}
          status={status}
          onReject={() => {
            editor?.commands.setContent(fromMarkdown(currentDocument));
            setAgentState({ document: currentDocument });
          }}
          onConfirm={() => {
            editor?.commands.setContent(fromMarkdown(agentState?.document || ""));
            setCurrentDocument(agentState?.document || "");
            setAgentState({ document: agentState?.document || "" });
          }}
        />
      ),
    },
    [agentState?.document, currentDocument]
  );

  // Present the proposed changes to the user for review
  useHumanInTheLoop(
    {
      agentId: "predictive_state_updates",
      name: "write_document",
      description: `Present the proposed changes to the user for review`,
      parameters: z.object({
        document: z.string().describe("The full updated document in markdown format"),
      }),
      render({ args, status, respond }: { args: { document?: string }; status: string; respond?: (result: unknown) => Promise<void> }) {
        if (status === "executing") {
          return (
            <ConfirmChanges
              args={args}
              respond={respond}
              status={status}
              onReject={() => {
                editor?.commands.setContent(fromMarkdown(currentDocument));
                setAgentState({ document: currentDocument });
              }}
              onConfirm={() => {
                editor?.commands.setContent(fromMarkdown(agentState?.document || ""));
                setCurrentDocument(agentState?.document || "");
                setAgentState({ document: agentState?.document || "" });
              }}
            />
          );
        }
        return <></>;
      },
    },
    [agentState?.document, currentDocument]
  );

  return (
    <div className="editor-wrapper">
      {placeholderVisible && (
        <div className="absolute top-10 left-10 pointer-events-none text-gray-400 font-medium">
          Write whatever you want here in Markdown format or ask the AI...
        </div>
      )}
      <div className="tiptap-container">
        <EditorContent editor={editor} />
      </div>
      <VoiceAgentWidget
        editor={editor}
        setAgentState={setAgentState}
        setCurrentDocument={setCurrentDocument}
      />
    </div>
  );
};

interface ConfirmChangesProps {
  args: any;
  respond: any;
  status: any;
  onReject: () => void;
  onConfirm: () => void;
}

function ConfirmChanges({ respond, status, onReject, onConfirm }: ConfirmChangesProps) {
  const [accepted, setAccepted] = useState<boolean | null>(null);
  return (
    <div
      data-testid="confirm-changes-modal"
      className="bg-white p-5 rounded-xl shadow-md border border-gray-100 my-4"
    >
      <h2 className="text-md font-bold text-gray-900 mb-2 flex items-center gap-2">
        <span>⚡</span> Confirm Proposed Changes
      </h2>
      <p className="text-sm text-gray-600 mb-4">Would you like to accept the new changes proposed by the AI editor?</p>
      {accepted === null && (
        <div className="flex justify-end space-x-3">
          <button
            data-testid="reject-button"
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium text-sm py-2 px-4 rounded-lg transition-colors"
            disabled={status !== "executing"}
            onClick={() => {
              if (respond) {
                setAccepted(false);
                onReject();
                respond({ accepted: false });
              }
            }}
          >
            Reject
          </button>
          <button
            data-testid="confirm-button"
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm py-2 px-4 rounded-lg shadow-sm shadow-blue-200 transition-colors"
            disabled={status !== "executing"}
            onClick={() => {
              if (respond) {
                setAccepted(true);
                onConfirm();
                respond({ accepted: true });
              }
            }}
          >
            Confirm
          </button>
        </div>
      )}
      {accepted !== null && (
        <div className="flex justify-end">
          <div
            data-testid="status-display"
            className={`text-sm font-semibold py-1.5 px-3 rounded-lg ${
              accepted 
                ? "bg-green-50 text-green-700 border border-green-200" 
                : "bg-red-50 text-red-700 border border-red-200"
            }`}
          >
            {accepted ? "✓ Accepted" : "✗ Rejected"}
          </div>
        </div>
      )}
    </div>
  );
}

function fromMarkdown(text: string) {
  const md = new MarkdownIt({
    typographer: true,
    html: true,
  });

  return md.render(text);
}

function diffPartialText(oldText: string, newText: string, isComplete: boolean = false) {
  let oldTextToCompare = oldText;
  if (oldText.length > newText.length && !isComplete) {
    oldTextToCompare = oldText.slice(0, newText.length);
  }

  const changes = diffWords(oldTextToCompare, newText);

  let result = "";
  changes.forEach((part) => {
    if (part.added) {
      result += `<em>${part.value}</em>`;
    } else if (part.removed) {
      result += `<s>${part.value}</s>`;
    } else {
      result += part.value;
    }
  });

  if (oldText.length > newText.length && !isComplete) {
    result += oldText.slice(newText.length);
  }

  return result;
}
