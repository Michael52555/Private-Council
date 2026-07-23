"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";


function PlanningBackground() {
  return (
    <div className="planning-background" aria-hidden="true">
      <div className="aurora aurora-blue" />
      <div className="aurora aurora-purple" />
      <div className="aurora aurora-green" />

      <svg
        className="connection-map"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
      >
        <path d="M120 180 C350 220 430 350 610 410" />
        <path d="M1320 160 C1100 210 1030 330 830 400" />
        <path d="M90 700 C300 650 410 570 610 500" />
        <path d="M1350 720 C1120 660 1030 580 830 510" />
      </svg>

      <span className="agent agent-one" />
      <span className="agent agent-two" />
      <span className="agent agent-three" />
      <span className="agent agent-four" />
      <span className="agent agent-five" />
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [planName, setPlanName] = useState("");
  const [error, setError] = useState("");

  function handleCreateRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedName = planName.trim();

    if (!trimmedName) {
      setError("Please enter a plan name.");
      return;
    }

    setError("");

    // Generate a temporary unique room ID in the browser.
    const roomId = crypto.randomUUID().slice(0, 8);

    const query = new URLSearchParams({
      name: trimmedName,
    });

    router.push(`/room/${roomId}?${query.toString()}`);
  }

  return (
    <main className="home-page">
      <PlanningBackground />

      <section className="home-card">
        <div className="home-card-glow" />

        <div className="privacy-badge">
          <span className="privacy-dot" />
          Private by design
        </div>

        <p className="mb-2 text-sm font-medium text-gray-500">
          Private planning for groups
        </p>

        <h1 className="mb-3 text-4xl font-bold tracking-tight text-gray-900">
          Private Council
        </h1>

        <p className="mb-8 leading-7 text-gray-600">
          Everyone shares their constraints privately. We find a plan that works
          without revealing why.
        </p>

        <div className="privacy-flow" aria-hidden="true">
          <span className="mini-agent mini-agent-purple" />
          <span className="flow-line" />
          <span className="council-node">◆</span>
          <span className="flow-line" />
          <span className="mini-agent mini-agent-green" />
        </div>

        <form onSubmit={handleCreateRoom}>
          <label
            htmlFor="plan-name"
            className="mb-2 block text-sm font-medium text-gray-800"
          >
            What are you planning?
          </label>

          <input
            id="plan-name"
            type="text"
            value={planName}
            onChange={(event) => setPlanName(event.target.value)}
            placeholder="Dinner this Saturday"
            className="plan-input"
          />

          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

          <button type="submit" className="create-room-button">
            Create private room
            <span aria-hidden="true">→</span>
          </button>
        </form>

        <p className="privacy-note">
          Participants’ private constraints are never shown to the group.
        </p>
      </section>
    </main>
    );
}