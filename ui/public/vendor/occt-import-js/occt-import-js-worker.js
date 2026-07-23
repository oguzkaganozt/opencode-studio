importScripts("occt-import-js.js")

onmessage = async (ev) => {
  const modulOverrides = {
    locateFile: (path) => path,
  }
  const occt = await occtimportjs(modulOverrides)
  const result = occt.ReadFile(ev.data.format, ev.data.buffer, ev.data.params)
  postMessage(result)
}
