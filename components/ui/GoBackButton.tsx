"use client"

import { useRouter } from 'next/navigation'

export default function GoBackButton() {
  const router = useRouter()
  
  return (
    <button
      onClick={() => router.back()}
      className="bg-amber-400 w-full lg:w-auto text-xl px-8 py-2.5 text-center font-bold cursor-pointer"
    >Regresar</button>
  )
}
