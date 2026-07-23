// "use client";

// import { FormEvent, useState } from "react";

// type Preference = {
//   id: string;
//   statement: string;
// };

// export default function PracticePage() {
//   const [statement, setStatement] = useState("");
//   const [preferences, setPreferences] = useState<Preference[]>([]);

//   function addPreference(event: FormEvent<HTMLFormElement>) {
//     event.preventDefault();

//     if(!statement.trim()){
//         return;
//     }

//     const newPreference: Preference = {
//       id: crypto.randomUUID(),
//       statement: statement.trim(),
//     };

//     setPreferences((currentPreferences) => [
//         ...currentPreferences,
//         newPreference,
//     ]);
//   }

//   {preferences.map((preference)=>(
//     <article key={preference.id}>
//         <p>preference.statement</p>
//     </article>
//   ))}

//   return (
//     <main className="p-10">
//       <form onSubmit={addPreference}>
//         <input
//           value={statement}
//           onChange={(event) => setStatement(event.target.value)}
//           className="border p-2"
//         />

//         <button type="submit" className="ml-2 border p-2">
//           Add
//         </button>
//       </form>

//       <div className="mt-6">
//         {/* 你来用 preferences.map(...) 显示每一条 */}
//       </div>
//     </main>
//   );
// }