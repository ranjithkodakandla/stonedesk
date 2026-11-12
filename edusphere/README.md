# EduSphere – Complete NCERT Student Learning Platform

EduSphere is a free, browser-based educational platform for CBSE students in Classes 8, 9 and 10. It runs entirely in the browser using HTML, CSS and vanilla JavaScript — no backend or paid services required.

## Features

| Feature | Description |
|---|---|
| 📚 NCERT Syllabus | Classes 8, 9 & 10 with all official subjects and chapters (2026–27 session) |
| 📝 Homework Tracker | Add, edit, delete, and complete assignments with due-date alerts |
| ⏱️ Study Timer | Pomodoro timer with custom durations and session tracking |
| 🃏 Flashcards | Built-in decks + create your own; flip and track learned cards |
| 🎯 Quizzes | Multiple-choice quizzes with instant feedback and score history |
| 📊 Progress Dashboard | Charts, stats, study time, quiz scores, chapter completion |
| 🏆 Gamification | XP, levels, achievements and daily challenges |
| 🤖 AI Checker (Demo) | Interface for AI answer feedback (demo mode; real AI ready to plug in) |
| 🌐 Language | English and Hindi interface toggle |
| 🌙 Themes | Dark and light modes |
| 💾 Local Storage | All data saved in-browser; no account needed |

## Deployment on GitHub Pages

1. Push this repository to GitHub.
2. Go to **Settings → Pages**.
3. Set the source to `main` branch, root `/` (or `/edusphere` if deploying from a subfolder).
4. EduSphere will be live at `https://<username>.github.io/<repo>/edusphere/`.

## Project Structure

```
edusphere/
├── index.html          # Single-page app shell
├── style.css           # All styles, dark/light themes, responsive
├── script.js           # Full application logic
├── data/
│   ├── syllabus.json   # NCERT syllabus data
│   ├── quizzes.json    # Sample quiz questions
│   └── flashcards.json # Sample flashcard decks
└── assets/             # Icons and images
```

## Official NCERT Resources

- Textbooks: https://ncert.nic.in/textbook.php
- Publications: https://ncert.nic.in/list-publication.php
- CBSE Curriculum: https://cbseacademic.nic.in/curriculum_2027.html

## Important Notes

- NCERT textbook PDFs are **not** hosted here. Links point to the official NCERT website.
- All data is browser-local (localStorage). It does not sync across devices.
- The AI Answer Checker is in demo mode. No real AI API calls are made and no keys are exposed.
- Syllabus content aligns with the CBSE 2026–27 academic session.

## Future Roadmap

- Cloud data sync (Firebase / Supabase)
- Real AI answer checking (Anthropic / Google API)
- Secure student accounts
- Teacher dashboard
- Leaderboards
- More classes and subjects

## License

Free to use for personal educational purposes.
