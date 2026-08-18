import React from "react"
import "tscircuit"

export default () => (
  <board width="10mm" height="8mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={0} pcbY={0} schX={-2} schY={0} />
    <resistor name="R2" resistance="1k" footprint="0603" pcbX={0} pcbY={0} schX={2} schY={0} />
  </board>
)
