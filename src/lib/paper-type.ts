// A paper type as people read it, on the server and in the browser: the stored "Document" is
// "Other paper", the firm's note of an acknowledgement number says so, and the new forms name
// the ones they replace.
const typeNames: Record<string, string> = { Document: "Other paper", "Filing record": "Acknowledgement number", "Form 130": "Form No. 130 (was Form 16)", "Form 168": "Form No. 168 (was Form 26AS)" };
export const paperType = (type: string) => typeNames[type] ?? type;
// A paper asked of a client names the new form beside the old one, as either answers it.
const askNames: Record<string, string> = { "Form 16": "Form 16 or Form No. 130" };
export const askName = (type: string) => askNames[type] ?? type;
