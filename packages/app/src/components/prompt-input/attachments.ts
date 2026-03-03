import { onCleanup, onMount } from "solid-js"
import { showToast } from "@opencode-ai/ui/toast"
import { usePrompt, type ContentPart, type ImageAttachmentPart } from "@/context/prompt"
import { useLanguage } from "@/context/language"
import { uuid } from "@/utils/uuid"
import { getCursorPosition } from "./editor-dom"

export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]
export const ACCEPTED_FILE_TYPES = [...ACCEPTED_IMAGE_TYPES, "application/pdf"]
const LARGE_PASTE_CHARS = 8000
const LARGE_PASTE_BREAKS = 120
const NATIVE_DROP_EVENT = "opencode:native-file-drop"

type PathFile = File & { path?: string }
type NativeDropDetail = { paths?: string[] }

const WINDOWS_PATH = /^[A-Za-z]:[\\/]/
const UNC_PATH = /^\\\\/

function largePaste(text: string) {
  if (text.length >= LARGE_PASTE_CHARS) return true
  let breaks = 0
  for (const char of text) {
    if (char !== "\n") continue
    breaks += 1
    if (breaks >= LARGE_PASTE_BREAKS) return true
  }
  return false
}

type PromptAttachmentsInput = {
  editor: () => HTMLDivElement | undefined
  isFocused: () => boolean
  isDialogActive: () => boolean
  setDraggingType: (type: "image" | "@mention" | null) => void
  focusEditor: () => void
  addPart: (part: ContentPart) => boolean
  readClipboardImage?: () => Promise<File | null>
}

export function createPromptAttachments(input: PromptAttachmentsInput) {
  const prompt = usePrompt()
  const language = useLanguage()
  let nativeDropTime = 0

  const addImageAttachment = async (file: File) => {
    if (!ACCEPTED_FILE_TYPES.includes(file.type)) return

    const reader = new FileReader()
    reader.onload = () => {
      const editor = input.editor()
      if (!editor) return
      const dataUrl = reader.result as string
      const attachment: ImageAttachmentPart = {
        type: "image",
        id: uuid(),
        filename: file.name,
        mime: file.type,
        dataUrl,
      }
      const cursorPosition = prompt.cursor() ?? getCursorPosition(editor)
      prompt.set([...prompt.current(), attachment], cursorPosition)
    }
    reader.readAsDataURL(file)
  }

  const addFileReference = (path: string) => {
    if (!path) return
    input.focusEditor()
    input.addPart({ type: "file", path, content: "@" + path, start: 0, end: 0 })
  }

  const fileItemPath = (file: File | null) => {
    if (!file) return null
    const path = (file as PathFile).path
    if (!path?.trim()) return null
    return path
  }

  const fromFileUri = (value: string) => {
    if (!value.startsWith("file:")) return null
    if (!URL.canParse(value)) return value.slice(5)
    const uri = new URL(value)
    if (uri.protocol !== "file:") return null
    const pathname = decodeURIComponent(uri.pathname)
    if (/^\/[A-Za-z]:\//.test(pathname)) return pathname.slice(1)
    if (uri.host) return `//${uri.host}${pathname}`
    return pathname
  }

  const normalizePath = (value: string) => {
    const path = value.trim()
    if (!path) return null
    const fromUri = fromFileUri(path)
    if (fromUri) return fromUri
    if (path.startsWith("/") || WINDOWS_PATH.test(path) || UNC_PATH.test(path)) return path
    return null
  }

  const droppedPaths = (event: DragEvent) => {
    const transfer = event.dataTransfer
    const hasFiles = (transfer?.files.length ?? 0) > 0
    const types = [
      "text/uri-list",
      "text/plain",
      "public.file-url",
      "text/x-moz-url",
      ...(transfer?.types ?? []).filter((type) => type.includes("uri") || type.includes("file")),
    ]
    const list = Array.from(new Set(types))
      .map((type) => transfer?.getData(type) ?? "")
      .flatMap((text) => (text ?? "").split("\n"))
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .flatMap((line) => {
        const path = normalizePath(line)
        if (path) return [path]
        if (!hasFiles) return []
        if (line.startsWith("/") || WINDOWS_PATH.test(line) || UNC_PATH.test(line)) return [decodeURIComponent(line)]
        return []
      })
    return Array.from(new Set(list))
  }

  const removeImageAttachment = (id: string) => {
    const current = prompt.current()
    const next = current.filter((part) => part.type !== "image" || part.id !== id)
    prompt.set(next, prompt.cursor())
  }

  const handlePaste = async (event: ClipboardEvent) => {
    if (!input.isFocused()) return
    const clipboardData = event.clipboardData
    if (!clipboardData) return

    event.preventDefault()
    event.stopPropagation()

    const items = Array.from(clipboardData.items)
    const fileItems = items.filter((item) => item.kind === "file")
    const imageItems = fileItems.filter((item) => ACCEPTED_FILE_TYPES.includes(item.type))

    if (imageItems.length > 0) {
      for (const item of imageItems) {
        const file = item.getAsFile()
        if (file) await addImageAttachment(file)
      }
      return
    }

    if (fileItems.length > 0) {
      const paths = fileItems
        .flatMap((item) => {
          const path = fileItemPath(item.getAsFile())
          return path ? [path] : []
        })
        .filter((path, index, list) => list.indexOf(path) === index)
      if (paths.length > 0) {
        paths.forEach(addFileReference)
        return
      }

      showToast({
        title: language.t("prompt.toast.pasteUnsupported.title"),
        description: language.t("prompt.toast.pasteUnsupported.description"),
      })
      return
    }

    const plainText = clipboardData.getData("text/plain") ?? ""

    // Desktop: Browser clipboard has no images and no text, try platform's native clipboard for images
    if (input.readClipboardImage && !plainText) {
      const file = await input.readClipboardImage()
      if (file) {
        await addImageAttachment(file)
        return
      }
    }

    if (!plainText) return

    if (largePaste(plainText)) {
      if (input.addPart({ type: "text", content: plainText, start: 0, end: 0 })) return
      input.focusEditor()
      if (input.addPart({ type: "text", content: plainText, start: 0, end: 0 })) return
    }

    const inserted = typeof document.execCommand === "function" && document.execCommand("insertText", false, plainText)
    if (inserted) return

    input.addPart({ type: "text", content: plainText, start: 0, end: 0 })
  }

  const handleGlobalDragOver = (event: DragEvent) => {
    if (input.isDialogActive()) return

    event.preventDefault()
    const hasFiles = event.dataTransfer?.types.includes("Files")
    const hasText = event.dataTransfer?.types.includes("text/plain")
    if (hasFiles) {
      const files = Array.from(event.dataTransfer?.items ?? []).filter((item) => item.kind === "file")
      const hasMedia = files.some((item) => ACCEPTED_FILE_TYPES.includes(item.type))
      input.setDraggingType(hasMedia ? "image" : "@mention")
    } else if (hasText) {
      input.setDraggingType("@mention")
    }
  }

  const handleGlobalDragLeave = (event: DragEvent) => {
    if (input.isDialogActive()) return
    if (!event.relatedTarget) {
      input.setDraggingType(null)
    }
  }

  const handleGlobalDrop = async (event: DragEvent) => {
    if (input.isDialogActive()) return

    event.preventDefault()
    input.setDraggingType(null)

    const paths = droppedPaths(event)
    if (paths.length > 0) {
      paths.forEach(addFileReference)
      return
    }

    const dropped = event.dataTransfer?.files
    if (!dropped) return

    if (Date.now() - nativeDropTime < 1000) return

    let added = 0
    let unknown = 0
    for (const file of Array.from(dropped)) {
      if (ACCEPTED_FILE_TYPES.includes(file.type)) {
        await addImageAttachment(file)
        added += 1
        continue
      }

      const path = fileItemPath(file)
      if (path) {
        addFileReference(path)
        added += 1
        continue
      }
      unknown += 1
    }

    if (added > 0 || unknown === 0) return

    showToast({
      title: language.t("prompt.toast.pasteUnsupported.title"),
      description: language.t("prompt.toast.pasteUnsupported.description"),
    })

    if (import.meta.env.DEV) {
      const types = event.dataTransfer?.types ?? []
      const files = Array.from(event.dataTransfer?.files ?? []).map((file) => {
        const path = fileItemPath(file)
        return { name: file.name, type: file.type, size: file.size, path }
      })
      console.info("[prompt-drop] unresolved file drop", { types, files })
    }
  }

  const handleNativeDrop = (event: Event) => {
    if (input.isDialogActive()) return
    const detail = (event as CustomEvent<NativeDropDetail>).detail
    const paths = (detail?.paths ?? []).flatMap((path) => {
      const value = normalizePath(path)
      return value ? [value] : []
    })
    if (paths.length === 0) return
    nativeDropTime = Date.now()
    Array.from(new Set(paths)).forEach(addFileReference)
  }

  onMount(() => {
    window.addEventListener(NATIVE_DROP_EVENT, handleNativeDrop as EventListener)
    document.addEventListener("dragover", handleGlobalDragOver)
    document.addEventListener("dragleave", handleGlobalDragLeave)
    document.addEventListener("drop", handleGlobalDrop)
  })

  onCleanup(() => {
    window.removeEventListener(NATIVE_DROP_EVENT, handleNativeDrop as EventListener)
    document.removeEventListener("dragover", handleGlobalDragOver)
    document.removeEventListener("dragleave", handleGlobalDragLeave)
    document.removeEventListener("drop", handleGlobalDrop)
  })

  return {
    addImageAttachment,
    removeImageAttachment,
    handlePaste,
  }
}
