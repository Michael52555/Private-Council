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
        {/* Left agents */}
        <path d="M260 190 C420 220 520 270 620 310" />
        <path d="M220 450 C390 450 510 450 620 450" />
        <path d="M260 710 C420 680 520 630 620 590" />

        {/* Right agents */}
        <path d="M1180 190 C1020 220 920 270 820 310" />
        <path d="M1220 450 C1050 450 930 450 820 450" />
        <path d="M1180 710 C1020 680 920 630 820 590" />

        {/* Left agent nodes */}
        <circle
          className="map-agent map-agent-pink"
          cx="260"
          cy="190"
          r="7"
        />
        <circle
          className="map-agent map-agent-blue"
          cx="220"
          cy="450"
          r="7"
        />
        <circle
          className="map-agent map-agent-purple"
          cx="260"
          cy="710"
          r="7"
        />

        {/* Right agent nodes */}
        <circle
          className="map-agent map-agent-green"
          cx="1180"
          cy="190"
          r="7"
        />
        <circle
          className="map-agent map-agent-gold"
          cx="1220"
          cy="450"
          r="7"
        />
        <circle
          className="map-agent map-agent-rose"
          cx="1180"
          cy="710"
          r="7"
        />
      </svg>
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

    router.push(
    `/room/${roomId}/setup?name=${encodeURIComponent(
      planName,
    )}`,
  );;
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