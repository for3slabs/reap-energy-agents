# Visión, misión y objetivo

Este documento fija para qué existe el proyecto y por qué está construido así. Se basa en la documentación
de Reap Agentic Payments, las reglas del hackathon (aibuilders.mx/reap) y pruebas reales contra el sandbox
del 2026-10-09.

## Visión

Que una planta pueda delegar en un agente el ciclo completo de mantenimiento eléctrico, desde detectar la
máquina que desperdicia energía hasta pagar la pieza, sin confundir nunca **una compra hecha con una máquina
reparada**.

## Misión

Conectar tres sistemas que hoy no se hablan:

1. **El medidor**, que sabe qué máquina consume de más.
2. **El riel de pago** (Reap Agentic Payments), que puede comprar la pieza sin que el agente toque una tarjeta.
3. **Un contrato**, que fija cuánto puede gastar el agente por máquina y registra si el consumo volvió a la
   normalidad después de la reparación.

## Objetivo del hackathon

Demostrar en una consola funcional, contra el sandbox real de Reap, el circuito completo de una máquina:
diagnóstico → cotización real → política on-chain → checkout aprobado en Reap → reparación → verificación
on-chain. Track elegido: **Best Bridge Between Onchain and Real World**.

## Lo que encontramos al investigar

| Hallazgo | Qué significa para el diseño |
|---|---|
| Reap guarda la tarjeta y aprueba cada cargo en páginas propias (`EXTERNAL` enrollment, `nextAction.url`) | El agente nunca ve datos de tarjeta; cumple la regla de no dar tarjetas a un LLM |
| `POST /agentic/quotes` devuelve el total final con envío e impuestos y **vence** (~15 min) | La política se evalúa sobre el total final, nunca sobre el precio de lista; si vence, se recotiza |
| `Idempotency-Key` es obligatorio en enrollments, quotes y checkouts | Una llave por compra, reutilizada al reintentar: un doble clic no cobra dos veces |
| Los **mandates** (límites aprobados por el usuario) "no están disponibles todavía" | El límite de gasto que Reap aún no ofrece lo pone el contrato: es el puente on-chain |
| Reap exige `returnUrl` **HTTPS** (medido: `http://localhost` → 422 `invalid_format`) | El registro de tarjeta solo funciona en el sitio desplegado |
| El catálogo del sandbox vende repuestos eléctricos reales: capacitores de marcha ($8–16), contactores ($25–35), ventiladores ($3–9), fuentes de 24 V ($16–53) | La idea es viable con comercios soportados, sin catálogo propio |
| Cotización real medida: capacitor 30 µF $11.16 + envío $24.97 = **$37.25** | El envío pesa más que la pieza: la política debe mirar el total |
| Las reglas desaconsejan "chatbots genéricos que buscan y compran" | El agente no conversa: diagnostica con reglas y compra una pieza concreta |

## Lo que no es

- No es otro sistema de límites de gasto genérico: Reap, AP2 y las wallets con políticas ya cubren eso. Lo
  propio es atar el gasto a un **resultado físico medible** (el consumo de la máquina).
- No usa un LLM para decidir cuánto gastar. Las reglas deciden; un modelo, si se añade, solo explica.
