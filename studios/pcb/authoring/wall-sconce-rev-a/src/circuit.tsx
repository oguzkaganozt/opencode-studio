import React from "react"
import "tscircuit"

const r0402 = "kicad:Resistor_SMD/R_0402_1005Metric"
const c0402 = "kicad:Capacitor_SMD/C_0402_1005Metric"
const c0805 = "kicad:Capacitor_SMD/C_0805_2012Metric"
const sot23 = "kicad:Package_TO_SOT_SMD/SOT-23"
const sot23_6 = "kicad:Package_TO_SOT_SMD/SOT-23-6"
const tsot23_6 = "kicad:Package_TO_SOT_SMD/TSOT-23-6"
const ledConnector =
  "kicad:Connector_JST/JST_VH_B2P-VH_1x02_P3.96mm_Vertical"

const tps259470Footprint = (
  <footprint>
    <smtpad pcbX={-1.05} pcbY={0.75} layer="top" shape="rect" width={0.5} height={0.2} portHints={["pin1"]} />
    <smtpad pcbX={-1.05} pcbY={0.25} layer="top" shape="rect" width={0.5} height={0.2} portHints={["pin2"]} />
    <smtpad pcbX={-1.05} pcbY={-0.25} layer="top" shape="rect" width={0.5} height={0.2} portHints={["pin3"]} />
    <smtpad pcbX={-1.05} pcbY={-0.75} layer="top" shape="rect" width={0.5} height={0.2} portHints={["pin4"]} />
    <smtpad pcbX={-0.5} pcbY={-1.05} layer="top" shape="rect" width={0.2} height={0.5} portHints={["pin5"]} />
    <smtpad pcbX={0.5} pcbY={-1.05} layer="top" shape="rect" width={0.2} height={0.5} portHints={["pin6"]} />
    <smtpad pcbX={1.05} pcbY={-0.75} layer="top" shape="rect" width={0.5} height={0.2} portHints={["pin7"]} />
    <smtpad pcbX={1.05} pcbY={-0.25} layer="top" shape="rect" width={0.5} height={0.2} portHints={["pin8"]} />
    <smtpad pcbX={1.05} pcbY={0.25} layer="top" shape="rect" width={0.5} height={0.2} portHints={["pin9"]} />
    <smtpad pcbX={1.05} pcbY={0.75} layer="top" shape="rect" width={0.5} height={0.2} portHints={["pin10"]} />
    <smtpad pcbX={0} pcbY={0} layer="top" shape="rect" width={0.5} height={1.4} portHints={["pin11"]} />
  </footprint>
)

const DecouplingCap = ({
  name,
  capacitance,
  rail,
  schX,
  schY,
  pcbX,
  pcbY,
  footprint = c0402,
}: {
  name: string
  capacitance: string
  rail: string
  schX: number
  schY: number
  pcbX: number
  pcbY: number
  footprint?: string
}) => (
  <>
    <capacitor
      name={name}
      capacitance={capacitance}
      footprint={footprint}
      schX={schX}
      schY={schY}
      pcbX={pcbX}
      pcbY={pcbY}
    />
    <trace name={`${name}_rail`} from={`${name}.pin1`} to={rail} />
    <trace name={`${name}_ground`} from={`${name}.pin2`} to="net.GND" />
  </>
)

const LedSwitch = ({
  name,
  connector,
  pwmSource,
  schY,
  pcbY,
}: {
  name: string
  connector: string
  pwmSource: string
  schY: number
  pcbY: number
}) => (
  <>
    <resistor
      name={`R_${name}_GATE`}
      resistance="33ohm"
      footprint={r0402}
      schX={8}
      schY={schY}
      pcbX={19}
      pcbY={pcbY}
    />
    <resistor
      name={`R_${name}_PULLDOWN`}
      resistance="100kohm"
      footprint={r0402}
      schX={12}
      schY={schY - 3}
      pcbX={21}
      pcbY={pcbY - 2}
    />
    <chip
      name={`Q_${name}`}
      manufacturerPartNumber="AO3400A"
      footprint={sot23}
      pinLabels={{ pin1: "GATE", pin2: "SOURCE", pin3: "DRAIN" }}
      pinAttributes={{ SOURCE: { requiresGround: true } }}
      schX={14}
      schY={schY}
      pcbX={24}
      pcbY={pcbY}
    />
    <connector
      name={connector}
      manufacturerPartNumber="B2P-VH(LF)(SN)"
      footprint={ledConnector}
      pinLabels={{ pin1: "VCC", pin2: "RETURN" }}
      schX={21}
      schY={schY}
      pcbX={29}
      pcbY={pcbY}
    />
    <trace
      name={`${name}_pwm_gate`}
      from={pwmSource}
      to={`R_${name}_GATE.pin1`}
    />
    <trace
      name={`${name}_gate_drive`}
      from={`R_${name}_GATE.pin2`}
      to={`Q_${name}.GATE`}
    />
    <trace
      name={`${name}_gate_pulldown`}
      from={`Q_${name}.GATE`}
      to={`R_${name}_PULLDOWN.pin1`}
    />
    <trace
      name={`${name}_pulldown_ground`}
      from={`R_${name}_PULLDOWN.pin2`}
      to="net.GND"
    />
    <trace
      name={`${name}_source_ground`}
      from={`Q_${name}.SOURCE`}
      to="net.GND"
    />
    <trace
      name={`${name}_switched_return`}
      from={`Q_${name}.DRAIN`}
      to={`${connector}.RETURN`}
    />
    <trace
      name={`${name}_protected_5v`}
      from={`${connector}.VCC`}
      to="net.PROTECTED_5V"
    />
  </>
)

const unusedEspPins = [
  "IO1",
  "IO2",
  "IO3",
  "IO12",
  "IO13",
  "IO14",
  "IO15",
  "IO16",
  "IO21",
  "IO35",
  "IO36",
  "IO37",
  "IO38",
  "IO39",
  "IO40",
  "IO41",
  "IO42",
  "IO45",
  "IO46",
  "IO47",
  "IO48",
]

export default () => (
  <board width="70mm" height="45mm" layers={2}>
    <hole name="H_MOUNT_TOP_LEFT" diameter="3.2mm" pcbX={-30} pcbY={17.5} />
    <hole name="H_MOUNT_TOP_RIGHT" diameter="3.2mm" pcbX={30} pcbY={17.5} />
    <hole name="H_MOUNT_BOTTOM_LEFT" diameter="3.2mm" pcbX={-30} pcbY={-17.5} />
    <hole name="H_MOUNT_BOTTOM_RIGHT" diameter="3.2mm" pcbX={30} pcbY={-17.5} />

    <connector
      name="J_USB_C"
      standard="usb_c"
      manufacturerPartNumber="USB4105-GF-A-120"
      footprint="kicad:Connector_USB/USB_C_Receptacle_GCT_USB4105-xx-A_16P_TopMnt_Horizontal"
      noConnect={["A6", "A7", "A8", "B6", "B7", "B8"]}
      schX={-32}
      schY={10}
      pcbX={-30}
    />

    <chip
      name="U_TYPE_C"
      manufacturerPartNumber="TUSB320LAIRWBR"
      footprint="kicad:Package_DFN_QFN/Texas_X2QFN-12_1.6x1.6mm_P0.4mm"
      pinLabels={{
        pin1: "CC1",
        pin2: "CC2",
        pin3: "PORT",
        pin4: "VBUS_DET",
        pin5: "ADDR",
        pin6: "INT_N",
        pin7: "SDA",
        pin8: "SCL",
        pin9: "ID",
        pin10: "GND",
        pin11: "EN_N",
        pin12: "VDD",
      }}
      pinAttributes={{
        VDD: { requiresPower: true, requiresVoltage: "5V" },
        GND: { requiresGround: true },
        SDA: { activeCapability: "i2c_sda", needsExternalPullup: true },
        SCL: { activeCapability: "i2c_scl", needsExternalPullup: true },
      }}
      noConnect={["ID"]}
      schX={-21}
      schY={11}
      pcbX={-24}
      pcbY={10}
    />
    <resistor
      name="R_VBUS_DET"
      resistance="887kohm"
      footprint={r0402}
      schX={-26}
      schY={5}
      pcbX={-28}
      pcbY={7}
    />
    <resistor
      name="R_TYPE_C_SDA_PULLUP"
      resistance="4.7kohm"
      footprint={r0402}
      schX={-15}
      schY={15}
      pcbX={-20}
      pcbY={13}
    />
    <resistor
      name="R_TYPE_C_SCL_PULLUP"
      resistance="4.7kohm"
      footprint={r0402}
      schX={-12}
      schY={15}
      pcbX={-18}
      pcbY={11}
    />
    <resistor
      name="R_TYPE_C_INT_PULLUP"
      resistance="10kohm"
      footprint={r0402}
      schX={-9}
      schY={15}
      pcbX={-20}
      pcbY={8}
    />
    <DecouplingCap
      name="C_TYPE_C"
      capacitance="100nF"
      rail="net.VBUS_5V"
      schX={-21}
      schY={5}
      pcbX={-23}
      pcbY={7}
    />

    <chip
      name="U_EFUSE"
      manufacturerPartNumber="TPS259470ARPWR"
      footprint={tps259470Footprint}
      pinLabels={{
        pin1: "EN_UVLO",
        pin2: "OVLO",
        pin3: "AUXOFF",
        pin4: "FLT",
        pin5: "IN",
        pin6: "OUT",
        pin7: "DVDT",
        pin8: "GND",
        pin9: "ILM",
        pin10: "ITIMER",
        pin11: "EPAD",
      }}
      pinAttributes={{
        IN: { requiresPower: true, requiresVoltage: "5V" },
        OUT: { providesPower: true, providesVoltage: "5V" },
        GND: { requiresGround: true },
        EPAD: { requiresGround: true },
      }}
      noConnect={["AUXOFF", "ITIMER"]}
      schX={-20}
      schY={-3}
      pcbX={-24}
      pcbY={-8}
    />
    <resistor
      name="R_EFUSE_ILM"
      resistance="1.18kohm"
      footprint={r0402}
      schX={-18}
      schY={-8}
      pcbX={-21}
      pcbY={-12}
    />
    <resistor
      name="R_EFUSE_OVLO"
      resistance="10kohm"
      footprint={r0402}
      schX={-24}
      schY={-8}
      pcbX={-27}
      pcbY={-5}
    />
    <resistor
      name="R_EFUSE_FLT_PULLUP"
      resistance="10kohm"
      footprint={r0402}
      schX={-14}
      schY={1}
      pcbX={-20}
      pcbY={-6}
    />
    <capacitor
      name="C_EFUSE_DVDT"
      capacitance="10nF"
      footprint={c0402}
      schX={-15}
      schY={-6}
      pcbX={-25}
      pcbY={-12}
    />
    <DecouplingCap
      name="C_VBUS_INPUT"
      capacitance="1uF"
      rail="net.VBUS_5V"
      schX={-28}
      schY={-4}
      pcbX={-29}
      pcbY={-8}
      footprint={c0805}
    />
    <DecouplingCap
      name="C_PROTECTED_5V"
      capacitance="22uF"
      rail="net.PROTECTED_5V"
      schX={-11}
      schY={-4}
      pcbX={-18}
      pcbY={-16}
      footprint={c0805}
    />

    <chip
      name="U_BUCK"
      manufacturerPartNumber="AP63300WU-7"
      footprint={tsot23_6}
      pinLabels={{
        pin1: "FB",
        pin2: "EN",
        pin3: "VIN",
        pin4: "GND",
        pin5: "SW",
        pin6: "BST",
      }}
      pinAttributes={{
        VIN: { requiresPower: true, requiresVoltage: "5V" },
        GND: { requiresGround: true },
      }}
      schX={-6}
      schY={-4}
      pcbX={-15}
      pcbY={-9}
    />
    <inductor
      name="L_BUCK"
      manufacturerPartNumber="XAL5030-472MEC"
      inductance="4.7uH"
      footprint="kicad:Inductor_SMD/L_Coilcraft_XAL5030-XXX"
      schX={2}
      schY={-4}
      pcbX={-10.5}
      pcbY={-14.5}
    />
    <resistor
      name="R_BUCK_FB_TOP"
      resistance="93.1kohm"
      footprint={r0402}
      schX={7}
      schY={-5}
      pcbX={-4}
      pcbY={-13}
    />
    <resistor
      name="R_BUCK_FB_BOTTOM"
      resistance="30.1kohm"
      footprint={r0402}
      schX={7}
      schY={-9}
      pcbX={0}
      pcbY={-13}
    />
    <capacitor
      name="C_BUCK_FEED_FORWARD"
      capacitance="56pF"
      footprint={c0402}
      schX={7}
      schY={-2}
      pcbX={-1}
      pcbY={-11}
    />
    <capacitor
      name="C_BUCK_BOOTSTRAP"
      capacitance="100nF"
      footprint={c0402}
      schX={-1}
      schY={-1}
      pcbX={-12}
      pcbY={-6}
    />
    <DecouplingCap
      name="C_BUCK_INPUT"
      capacitance="10uF"
      rail="net.PROTECTED_5V"
      schX={-9}
      schY={-10}
      pcbX={-18}
      pcbY={-4}
      footprint={c0805}
    />
    <DecouplingCap
      name="C_BUCK_OUTPUT_1"
      capacitance="22uF"
      rail="net.POWER_3V3"
      schX={12}
      schY={-4}
      pcbX={2}
      pcbY={-9}
      footprint={c0805}
    />
    <DecouplingCap
      name="C_BUCK_OUTPUT_2"
      capacitance="22uF"
      rail="net.POWER_3V3"
      schX={15}
      schY={-4}
      pcbX={5.5}
      pcbY={-9}
      footprint={c0805}
    />

    <chip
      name="U_MCU"
      manufacturerPartNumber="ESP32-S3-WROOM-1-N8R8"
      footprint="kicad:RF_Module/ESP32-S3-WROOM-1"
      pinLabels={{
        pin1: "GND1",
        pin2: "VDD33",
        pin3: "EN",
        pin4: "IO4",
        pin5: "IO5",
        pin6: "IO6",
        pin7: "IO7",
        pin8: "IO15",
        pin9: "IO16",
        pin10: "IO17",
        pin11: "IO18",
        pin12: "IO8",
        pin13: "IO19",
        pin14: "IO20",
        pin15: "IO3",
        pin16: "IO46",
        pin17: "IO9",
        pin18: "IO10",
        pin19: "IO11",
        pin20: "IO12",
        pin21: "IO13",
        pin22: "IO14",
        pin23: "IO21",
        pin24: "IO47",
        pin25: "IO48",
        pin26: "IO45",
        pin27: "IO0",
        pin28: "IO35",
        pin29: "IO36",
        pin30: "IO37",
        pin31: "IO38",
        pin32: "IO39",
        pin33: "IO40",
        pin34: "IO41",
        pin35: "IO42",
        pin36: "RXD0",
        pin37: "TXD0",
        pin38: "IO2",
        pin39: "IO1",
        pin40: "GND2",
        pin41: "EPAD",
      }}
      pinAttributes={{
        VDD33: { requiresPower: true, requiresVoltage: "3.3V" },
        GND1: { requiresGround: true },
        GND2: { requiresGround: true },
        EPAD: { requiresGround: true },
        IO8: { activeCapability: "i2c_sda" },
        IO9: { activeCapability: "i2c_scl" },
        IO17: { activeCapability: "uart_tx" },
        IO18: { activeCapability: "uart_rx" },
        TXD0: { activeCapability: "uart_tx" },
        RXD0: { activeCapability: "uart_rx" },
      }}
      noConnect={unusedEspPins}
      schX={18}
      schY={8}
      pcbX={3}
      pcbY={7}
    />
    <resistor
      name="R_MCU_EN_PULLUP"
      resistance="10kohm"
      footprint={r0402}
      schX={10}
      schY={15}
      pcbX={-8}
      pcbY={8}
    />
    <capacitor
      name="C_MCU_EN"
      capacitance="1uF"
      footprint={c0402}
      schX={10}
      schY={11}
      pcbX={-8}
      pcbY={10}
    />
    <resistor
      name="R_MCU_BOOT_PULLUP"
      resistance="10kohm"
      footprint={r0402}
      schX={14}
      schY={15}
      pcbX={19}
      pcbY={4}
    />
    <resistor
      name="R_MCU_UART_TX"
      resistance="499ohm"
      footprint={r0402}
      schX={28}
      schY={13}
      pcbX={20}
      pcbY={0}
    />
    <DecouplingCap
      name="C_MCU_BULK"
      capacitance="22uF"
      rail="net.POWER_3V3"
      schX={14}
      schY={2}
      pcbX={-8.5}
      pcbY={4}
      footprint={c0805}
    />
    <DecouplingCap
      name="C_MCU_DECOUPLING"
      capacitance="100nF"
      rail="net.POWER_3V3"
      schX={11}
      schY={2}
      pcbX={-8}
      pcbY={7}
    />

    <connector
      name="J_PROGRAM"
      manufacturerPartNumber="TC2050-IDC-NL"
      footprint="kicad:Connector/Tag-Connect_TC2050-IDC-NL_2x05_P1.27mm_Vertical"
      pinLabels={{
        pin1: "GND",
        pin2: "POWER_3V3",
        pin3: "UART_TX",
        pin4: "UART_RX",
        pin5: "USB_D_MINUS",
        pin6: "USB_D_PLUS",
        pin7: "BOOT",
        pin8: "RESET",
        pin9: "NC1",
        pin10: "NC2",
      }}
      noConnect={["NC1", "NC2"]}
      schX={31}
      schY={11}
      pcbX={14}
      pcbY={-18}
    />

    <connector
      name="J_PRESENCE"
      manufacturerPartNumber="HLK-LD2410C-24G"
      footprint="kicad:Connector_PinHeader_2.54mm/PinHeader_1x05_P2.54mm_Vertical"
      pinLabels={{
        pin1: "UART_TX",
        pin2: "UART_RX",
        pin3: "DETECT",
        pin4: "GND",
        pin5: "VCC",
      }}
      schX={31}
      schY={-1}
      pcbX={23}
      pcbY={0}
      pcbRotation={90}
    />
    <DecouplingCap
      name="C_PRESENCE"
      capacitance="10uF"
      rail="net.PROTECTED_5V"
      schX={26}
      schY={-6}
      pcbX={16}
      pcbY={-2}
      footprint={c0805}
    />

    <chip
      name="U_TOUCH"
      manufacturerPartNumber="AT42QT1010-TSHR"
      footprint={sot23_6}
      pinLabels={{
        pin1: "OUT",
        pin2: "VSS",
        pin3: "SNSK",
        pin4: "SNS",
        pin5: "VDD",
        pin6: "SYNC",
      }}
      pinAttributes={{
        VDD: { requiresPower: true, requiresVoltage: "3.3V" },
        VSS: { requiresGround: true },
      }}
      schX={20}
      schY={-10}
      pcbX={20}
      pcbY={-5}
    />
    <resistor
      name="R_TOUCH_SERIES"
      resistance="4.7kohm"
      footprint={r0402}
      schX={26}
      schY={-11}
      pcbX={24}
      pcbY={-5}
    />
    <capacitor
      name="C_TOUCH_SAMPLE"
      capacitance="4.7nF"
      footprint={c0402}
      schX={24}
      schY={-14}
      pcbX={19}
      pcbY={-9}
    />
    <DecouplingCap
      name="C_TOUCH_DECOUPLING"
      capacitance="100nF"
      rail="net.POWER_3V3"
      schX={16}
      schY={-14}
      pcbX={15}
      pcbY={-7}
    />
    <connector
      name="J_TOUCH_ELECTRODE"
      manufacturerPartNumber="B2B-PH-K-S(LF)(SN)"
      footprint="kicad:Connector_JST/JST_PH_B2B-PH-K_1x02_P2.00mm_Vertical"
      pinLabels={{ pin1: "ELECTRODE", pin2: "GND" }}
      schX={31}
      schY={-11}
      pcbX={4}
      pcbY={-18}
    />

    <trace name="usb_cc1" from="J_USB_C.A5" to="U_TYPE_C.CC1" />
    <trace name="usb_cc2" from="J_USB_C.B5" to="U_TYPE_C.CC2" />
    <trace name="usb_vbus_a4" from="J_USB_C.A4" to="net.VBUS_5V" />
    <trace name="usb_vbus_a9" from="J_USB_C.A9" to="net.VBUS_5V" />
    <trace name="usb_vbus_b4" from="J_USB_C.B4" to="net.VBUS_5V" />
    <trace name="usb_vbus_b9" from="J_USB_C.B9" to="net.VBUS_5V" />
    <trace name="usb_ground_a1" from="J_USB_C.A1" to="net.GND" />
    <trace name="usb_ground_a12" from="J_USB_C.A12" to="net.GND" />
    <trace name="usb_ground_b1" from="J_USB_C.B1" to="net.GND" />
    <trace name="usb_ground_b12" from="J_USB_C.B12" to="net.GND" />
    <trace name="usb_shield_1" from="J_USB_C.pin17" to="net.GND" />
    <trace name="usb_shield_2" from="J_USB_C.pin18" to="net.GND" />
    <trace name="usb_shield_3" from="J_USB_C.pin19" to="net.GND" />
    <trace name="usb_shield_4" from="J_USB_C.pin20" to="net.GND" />

    <trace name="type_c_vdd" from="U_TYPE_C.VDD" to="net.VBUS_5V" />
    <trace name="type_c_ground" from="U_TYPE_C.GND" to="net.GND" />
    <trace name="type_c_ufp_mode" from="U_TYPE_C.PORT" to="net.GND" />
    <trace name="type_c_i2c_address" from="U_TYPE_C.ADDR" to="net.GND" />
    <trace name="type_c_enable" from="U_TYPE_C.EN_N" to="net.GND" />
    <trace name="vbus_detect_input" from="R_VBUS_DET.pin1" to="net.VBUS_5V" />
    <trace name="vbus_detect_sense" from="R_VBUS_DET.pin2" to="U_TYPE_C.VBUS_DET" />
    <trace name="type_c_sda" from="U_TYPE_C.SDA" to="U_MCU.IO8" />
    <trace name="type_c_scl" from="U_TYPE_C.SCL" to="U_MCU.IO9" />
    <trace name="type_c_interrupt" from="U_TYPE_C.INT_N" to="U_MCU.IO11" />
    <trace name="type_c_sda_pullup_bus" from="R_TYPE_C_SDA_PULLUP.pin1" to="U_TYPE_C.SDA" />
    <trace name="type_c_sda_pullup_3v3" from="R_TYPE_C_SDA_PULLUP.pin2" to="net.POWER_3V3" />
    <trace name="type_c_scl_pullup_bus" from="R_TYPE_C_SCL_PULLUP.pin1" to="U_TYPE_C.SCL" />
    <trace name="type_c_scl_pullup_3v3" from="R_TYPE_C_SCL_PULLUP.pin2" to="net.POWER_3V3" />
    <trace name="type_c_int_pullup_bus" from="R_TYPE_C_INT_PULLUP.pin1" to="U_TYPE_C.INT_N" />
    <trace name="type_c_int_pullup_3v3" from="R_TYPE_C_INT_PULLUP.pin2" to="net.POWER_3V3" />

    <trace name="efuse_input" from="U_EFUSE.IN" to="net.VBUS_5V" />
    <trace name="efuse_enable" from="U_EFUSE.EN_UVLO" to="net.VBUS_5V" />
    <trace name="efuse_ovlo_disabled" from="U_EFUSE.OVLO" to="R_EFUSE_OVLO.pin1" />
    <trace name="efuse_ovlo_ground" from="R_EFUSE_OVLO.pin2" to="net.GND" />
    <trace name="efuse_output" from="U_EFUSE.OUT" to="net.PROTECTED_5V" />
    <trace name="efuse_ground" from="U_EFUSE.GND" to="net.GND" />
    <trace name="efuse_exposed_pad" from="U_EFUSE.EPAD" to="net.GND" />
    <trace name="efuse_current_limit" from="U_EFUSE.ILM" to="R_EFUSE_ILM.pin1" />
    <trace name="efuse_current_limit_ground" from="R_EFUSE_ILM.pin2" to="net.GND" />
    <trace name="efuse_dvdt" from="U_EFUSE.DVDT" to="C_EFUSE_DVDT.pin1" />
    <trace name="efuse_dvdt_ground" from="C_EFUSE_DVDT.pin2" to="net.GND" />
    <trace name="efuse_fault" from="U_EFUSE.FLT" to="U_MCU.IO10" />
    <trace name="efuse_fault_pullup_bus" from="R_EFUSE_FLT_PULLUP.pin1" to="U_EFUSE.FLT" />
    <trace name="efuse_fault_pullup_3v3" from="R_EFUSE_FLT_PULLUP.pin2" to="net.POWER_3V3" />

    <trace name="buck_input" from="U_BUCK.VIN" to="net.PROTECTED_5V" />
    <trace name="buck_enable" from="U_BUCK.EN" to="net.PROTECTED_5V" />
    <trace name="buck_ground" from="U_BUCK.GND" to="net.GND" />
    <trace name="buck_switch" from="U_BUCK.SW" to="L_BUCK.pin1" />
    <trace name="buck_output" from="L_BUCK.pin2" to="net.POWER_3V3" />
    <trace name="buck_bootstrap_high" from="U_BUCK.BST" to="C_BUCK_BOOTSTRAP.pin1" />
    <trace name="buck_bootstrap_switch" from="C_BUCK_BOOTSTRAP.pin2" to="U_BUCK.SW" />
    <trace name="buck_feedback_top_rail" from="R_BUCK_FB_TOP.pin1" to="net.POWER_3V3" />
    <trace name="buck_feedback" from="R_BUCK_FB_TOP.pin2" to="U_BUCK.FB" />
    <trace name="buck_feedback_bottom" from="U_BUCK.FB" to="R_BUCK_FB_BOTTOM.pin1" />
    <trace name="buck_feedback_ground" from="R_BUCK_FB_BOTTOM.pin2" to="net.GND" />
    <trace name="buck_feed_forward_rail" from="C_BUCK_FEED_FORWARD.pin1" to="net.POWER_3V3" />
    <trace name="buck_feed_forward_feedback" from="C_BUCK_FEED_FORWARD.pin2" to="U_BUCK.FB" />

    <trace name="mcu_power" from="U_MCU.VDD33" to="net.POWER_3V3" />
    <trace name="mcu_ground_1" from="U_MCU.GND1" to="net.GND" />
    <trace name="mcu_ground_2" from="U_MCU.GND2" to="net.GND" />
    <trace name="mcu_ground_epad" from="U_MCU.EPAD" to="net.GND" />
    <trace name="mcu_enable" from="U_MCU.EN" to="R_MCU_EN_PULLUP.pin1" />
    <trace name="mcu_enable_pullup" from="R_MCU_EN_PULLUP.pin2" to="net.POWER_3V3" />
    <trace name="mcu_enable_cap" from="U_MCU.EN" to="C_MCU_EN.pin1" />
    <trace name="mcu_enable_cap_ground" from="C_MCU_EN.pin2" to="net.GND" />
    <trace name="mcu_boot" from="U_MCU.IO0" to="R_MCU_BOOT_PULLUP.pin1" />
    <trace name="mcu_boot_pullup" from="R_MCU_BOOT_PULLUP.pin2" to="net.POWER_3V3" />

    <trace name="program_ground" from="J_PROGRAM.GND" to="net.GND" />
    <trace name="program_power" from="J_PROGRAM.POWER_3V3" to="net.POWER_3V3" />
    <trace name="program_uart_tx" from="U_MCU.TXD0" to="R_MCU_UART_TX.pin1" />
    <trace name="program_uart_tx_pad" from="R_MCU_UART_TX.pin2" to="J_PROGRAM.UART_TX" />
    <trace name="program_uart_rx" from="J_PROGRAM.UART_RX" to="U_MCU.RXD0" />
    <trace name="program_usb_d_minus" from="U_MCU.IO19" to="J_PROGRAM.USB_D_MINUS" />
    <trace name="program_usb_d_plus" from="U_MCU.IO20" to="J_PROGRAM.USB_D_PLUS" />
    <trace name="program_boot" from="U_MCU.IO0" to="J_PROGRAM.BOOT" />
    <trace name="program_reset" from="U_MCU.EN" to="J_PROGRAM.RESET" />

    <trace name="presence_power" from="J_PRESENCE.VCC" to="net.PROTECTED_5V" />
    <trace name="presence_ground" from="J_PRESENCE.GND" to="net.GND" />
    <trace name="presence_uart_to_mcu" from="J_PRESENCE.UART_TX" to="U_MCU.IO18" />
    <trace name="presence_uart_from_mcu" from="U_MCU.IO17" to="J_PRESENCE.UART_RX" />
    <trace name="presence_detect" from="J_PRESENCE.DETECT" to="U_MCU.IO6" />

    <trace name="touch_power" from="U_TOUCH.VDD" to="net.POWER_3V3" />
    <trace name="touch_ground" from="U_TOUCH.VSS" to="net.GND" />
    <trace name="touch_low_power_mode" from="U_TOUCH.SYNC" to="net.GND" />
    <trace name="touch_detect" from="U_TOUCH.OUT" to="U_MCU.IO7" />
    <trace name="touch_sample_high" from="U_TOUCH.SNSK" to="C_TOUCH_SAMPLE.pin1" />
    <trace name="touch_sample_low" from="C_TOUCH_SAMPLE.pin2" to="U_TOUCH.SNS" />
    <trace name="touch_series_input" from="U_TOUCH.SNSK" to="R_TOUCH_SERIES.pin1" />
    <trace name="touch_electrode" from="R_TOUCH_SERIES.pin2" to="J_TOUCH_ELECTRODE.ELECTRODE" />
    <trace name="touch_connector_ground" from="J_TOUCH_ELECTRODE.GND" to="net.GND" />

    <LedSwitch
      name="AMBER"
      connector="J_LED_AMBER"
      pwmSource="U_MCU.IO4"
      schY={19}
      pcbY={9}
    />
    <LedSwitch
      name="WARM_WHITE"
      connector="J_LED_WARM_WHITE"
      pwmSource="U_MCU.IO5"
      schY={-19}
      pcbY={-10}
    />
  </board>
)
