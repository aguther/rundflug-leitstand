export function createBoundedTextRecorder(maximumCharacters = 32_768) {
  if (!Number.isSafeInteger(maximumCharacters) || maximumCharacters < 1) {
    throw new TypeError("maximumCharacters must be a positive safe integer");
  }

  let capturedText = "";

  return {
    append(chunk) {
      capturedText = `${capturedText}${String(chunk)}`.slice(-maximumCharacters);
    },
    read() {
      return capturedText.trim();
    },
  };
}

function truncate(text, maximumCharacters) {
  if (text.length <= maximumCharacters) return text;
  return `${text.slice(0, maximumCharacters)}…`;
}

export async function createHttpFailure(
  label,
  response,
  runtimeOutput,
  maximumResponseCharacters = 2_048,
) {
  let responseBody;
  try {
    responseBody = truncate((await response.text()).trim(), maximumResponseCharacters);
  } catch (error) {
    responseBody = `<unavailable: ${error instanceof Error ? error.message : String(error)}>`;
  }

  return new Error(
    [
      `${label} (${response.status}).`,
      `Response body (limited to ${maximumResponseCharacters} characters): ${responseBody || "<empty>"}`,
      `Wrangler output (bounded tail): ${runtimeOutput || "<empty>"}`,
    ].join("\n"),
  );
}
