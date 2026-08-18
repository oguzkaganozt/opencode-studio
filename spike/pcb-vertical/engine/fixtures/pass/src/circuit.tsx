import React from "react"
import "tscircuit"

export default () => (
  <board width="20mm" height="15mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-5} pcbY={0} schX={-2} schY={0} />
    <capacitor name="C1" capacitance="100nF" footprint="0603" pcbX={5} pcbY={0} schX={2} schY={0} />
    <trace from=".R1 > .pin2" to=".C1 > .pin1" />
  </board>
)
