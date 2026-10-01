// Field names follow every reader and the stream accumulator in
// services/api/claude.ts: the text lives under `connector_text`.
export type ConnectorTextBlock = {
  type: 'connector_text';
  connector_text: string;
  signature?: string;
};

export type ConnectorTextDelta = {
  type: 'connector_text_delta';
  connector_text: string;
};

export function isConnectorTextBlock(block: unknown): block is ConnectorTextBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as ConnectorTextBlock).type === 'connector_text'
  );
}
