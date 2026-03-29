/**
 * Races a promise against a timer and rejects with the provided code if the timeout wins.
 */
function withTimeout(promise, timeoutMs, code = "TIMEOUT") {
  let timeoutId = 0;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(code));
    }, Math.max(0, timeoutMs));
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

export { withTimeout };
