"use client"

import * as React from "react"
import type { Combobox as ComboboxPrimitive } from "@base-ui/react"

import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
  type ComboboxInputProps,
} from "@/components/ui/combobox"

type SelectOption = {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

type SelectCommonProps = Omit<
  ComboboxInputProps,
  "children" | "defaultValue" | "multiple" | "onChange" | "value"
> & {
  options: SelectOption[]
  emptyText?: React.ReactNode
  autoHighlight?: ComboboxPrimitive.Root.Props<string>["autoHighlight"]
}

type SelectSingleProps = SelectCommonProps & {
  multiple?: false
  value?: ComboboxPrimitive.Root.Props<string, false>["value"]
  onChange?: ComboboxPrimitive.Root.Props<string, false>["onValueChange"]
}

type SelectMultipleProps = SelectCommonProps & {
  multiple: true
  value?: ComboboxPrimitive.Root.Props<string, true>["value"]
  onChange?: ComboboxPrimitive.Root.Props<string, true>["onValueChange"]
}

type SelectProps = SelectSingleProps | SelectMultipleProps

function Select({
  options,
  emptyText,
  value,
  onChange,
  autoHighlight,
  multiple,
  ...props
}: SelectProps) {
  const values = React.useMemo(
    () => options.map((option) => option.value),
    [options]
  )
  const getOption = React.useCallback(
    (value: string) => options.find((option) => option.value === String(value)),
    [options]
  )
  const anchorRef = useComboboxAnchor()

  if (multiple) {
    return (
      <Combobox<string, true>
        items={values}
        multiple
        autoHighlight={autoHighlight}
        itemToStringLabel={(value) =>
          getOption(String(value))?.label ?? String(value)
        }
        onValueChange={onChange as SelectMultipleProps["onChange"]}
        value={value as SelectMultipleProps["value"]}
      >
        <ComboboxChips ref={anchorRef} className="w-full">
          <ComboboxValue>
            {(selectedValue) =>
              (Array.isArray(selectedValue) ? selectedValue : []).map(
                (value) => {
                  const option = getOption(String(value))

                  return (
                    <ComboboxChip key={String(value)}>
                      {option?.label ?? String(value)}
                    </ComboboxChip>
                  )
                }
              )
            }
          </ComboboxValue>
          <ComboboxChipsInput {...props} />
        </ComboboxChips>
        <SelectContent
          anchor={anchorRef}
          emptyText={emptyText}
          options={options}
        />
      </Combobox>
    )
  }

  return (
    <Combobox<string, false>
      items={values}
      autoHighlight={autoHighlight}
      itemToStringLabel={(value) =>
        getOption(String(value))?.label ?? String(value)
      }
      onValueChange={onChange as SelectSingleProps["onChange"]}
      value={value as SelectSingleProps["value"]}
    >
      <ComboboxInput {...props} />
      <SelectContent emptyText={emptyText} options={options} />
    </Combobox>
  )
}

function SelectContent({
  anchor,
  emptyText,
  options,
}: {
  anchor?: ComboboxPrimitive.Positioner.Props["anchor"]
  emptyText: React.ReactNode
  options: SelectOption[]
}) {
  const optionMap = React.useMemo(
    () => new Map(options.map((option) => [option.value, option])),
    [options]
  )

  return (
    <ComboboxContent anchor={anchor}>
      <ComboboxEmpty>
        {emptyText ? emptyText : "No items found."}
      </ComboboxEmpty>
      <ComboboxList>
        {(value: string) => {
          const option = optionMap.get(String(value))

          if (!option) {
            return null
          }

          return (
            <ComboboxItem
              key={option.value}
              disabled={option.disabled}
              value={option.value}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{option.label}</span>
                {option.description && (
                  <span className="truncate text-xs text-muted-foreground">
                    {option.description}
                  </span>
                )}
              </span>
            </ComboboxItem>
          )
        }}
      </ComboboxList>
    </ComboboxContent>
  )
}

export { Select }
export type { SelectOption, SelectProps }
