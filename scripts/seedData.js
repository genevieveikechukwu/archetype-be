const bcrypt = require("bcrypt");
const {
  sequelize,
  User,
  Skill,
  Course,
  CourseSkill,
  CourseContent,
  Enrollment,
  LearningSession,
  Test,
  TestQuestion,
  QuestionOption,
  Kudos,
} = require("../models");

async function seedData() {
  const t = await sequelize.transaction();

  try {
    console.log("🌱 Starting database seeding...\n");

    // Hash password for demo users
    const password = await bcrypt.hash("password123", 10);

    // Create Admin
    console.log("👤 Creating admin user...");
    const admin = await User.create(
      {
        email: "admin@archetypeos.com",
        password_hash: password,
        full_name: "System Admin",
        role: "admin",
      },
      { transaction: t },
    );
    console.log("✅ Admin created: admin@archetypeos.com / password123\n");

    // Create Supervisor
    console.log("👤 Creating supervisor user...");
    const supervisor = await User.create(
      {
        email: "supervisor@archetypeos.com",
        password_hash: password,
        full_name: "Jane Supervisor",
        role: "supervisor",
      },
      { transaction: t },
    );
    console.log(
      "✅ Supervisor created: supervisor@archetypeos.com / password123\n",
    );

    // Create Learners
    console.log("👥 Creating learner users...");
    const learnersData = [
      {
        email: "john.maker@archetypeos.com",
        full_name: "John Maker",
        archetype: "maker",
      },
      {
        email: "sarah.architect@archetypeos.com",
        full_name: "Sarah Architect",
        archetype: "architect",
      },
      {
        email: "mike.strategist@archetypeos.com",
        full_name: "Mike Strategist",
        archetype: "strategist",
      },
    ];

    const learners = [];
    for (const data of learnersData) {
      const learner = await User.create(
        {
          ...data,
          password_hash: password,
          role: "learner",
          supervisor_id: supervisor.id,
        },
        { transaction: t },
      );
      learners.push(learner);
      console.log(`✅ Learner created: ${data.email} / password123`);
    }
    console.log("");

    // Create Skills
    console.log("🎯 Creating skills...");
    const skillsData = [
      { name: "JavaScript", description: "JavaScript programming language" },
      { name: "React", description: "React.js library for building UIs" },
      { name: "Node.js", description: "Server-side JavaScript runtime" },
      { name: "PostgreSQL", description: "Relational database management" },
      {
        name: "System Design",
        description: "Software architecture and design patterns",
      },
      {
        name: "Problem Solving",
        description: "Algorithmic thinking and problem solving",
      },
    ];

    const skills = [];
    for (const data of skillsData) {
      const skill = await Skill.create(data, { transaction: t });
      skills.push(skill);
    }
    console.log(`✅ Created ${skills.length} skills\n`);

    // Create Courses
    console.log("📚 Creating courses...");
    const coursesData = [
      {
        title: "JavaScript Fundamentals",
        description: "Learn the basics of JavaScript programming",
        difficulty: "beginner",
        archetype: "maker",
        estimated_hours: 20,
        skillIndices: [0, 5],
      },
      {
        title: "React for Beginners",
        description: "Build modern web applications with React",
        difficulty: "beginner",
        archetype: "maker",
        estimated_hours: 30,
        skillIndices: [0, 1],
      },
      {
        title: "Backend with Node.js",
        description: "Server-side development with Node.js and Express",
        difficulty: "intermediate",
        archetype: "architect",
        estimated_hours: 40,
        skillIndices: [0, 2, 3],
      },
      {
        title: "System Design Principles",
        description: "Learn to design scalable systems",
        difficulty: "advanced",
        archetype: "architect",
        estimated_hours: 50,
        skillIndices: [4],
      },
    ];

    const courses = [];
    for (const data of coursesData) {
      const { skillIndices, ...courseData } = data;
      const course = await Course.create(
        {
          ...courseData,
          is_published: true,
          created_by: admin.id,
        },
        { transaction: t },
      );
      courses.push(course);

      // Link skills
      for (const idx of skillIndices) {
        await CourseSkill.create(
          {
            course_id: course.id,
            skill_id: skills[idx].id,
            weight: 1.0,
          },
          { transaction: t },
        );
      }

      // Add sample content
      await CourseContent.bulkCreate(
        [
          {
            course_id: course.id,
            title: "Introduction Video",
            content_type: "video",
            content_url: "https://example.com/video1.mp4",
            order_index: 0,
          },
          {
            course_id: course.id,
            title: "Course Materials PDF",
            content_type: "pdf",
            content_url: "https://example.com/materials.pdf",
            order_index: 1,
          },
          {
            course_id: course.id,
            title: "Official Documentation",
            content_type: "link",
            content_url: "https://example.com/docs",
            order_index: 2,
          },
        ],
        { transaction: t },
      );
    }
    console.log(`✅ Created ${courses.length} courses\n`);

    // Enroll learners
    console.log("📝 Enrolling learners in courses...");
    const enrollmentMap = [
      [0, 1],
      [1, 2],
      [2, 3],
    ];
    for (let i = 0; i < learners.length; i++) {
      for (const courseIdx of enrollmentMap[i]) {
        await Enrollment.create(
          {
            user_id: learners[i].id,
            course_id: courses[courseIdx].id,
            progress_percentage: Math.floor(Math.random() * 100),
          },
          { transaction: t },
        );
      }
    }
    console.log("✅ Learners enrolled in courses\n");

    // Add learning sessions
    console.log("⏰ Creating learning sessions...");
    const today = new Date();
    const reflections = [
      "React components",
      "API development",
      "database design",
      "problem solving",
    ];
    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);

      for (const learner of learners) {
        const hours = 5 + Math.random() * 3;
        const startTime = new Date(date);
        startTime.setHours(9, 0, 0, 0);
        const endTime = new Date(startTime);
        endTime.setHours(startTime.getHours() + Math.floor(hours));

        await LearningSession.create(
          {
            user_id: learner.id,
            start_time: startTime,
            end_time: endTime,
            reflection_text: `Worked on ${reflections[Math.floor(Math.random() * 4)]} today. Made good progress.`,
          },
          { transaction: t },
        );
      }
    }
    console.log("✅ Created learning sessions for past 7 days\n");

    // Create tests
    console.log("📝 Creating tests...");
    const test = await Test.create(
      {
        course_id: courses[0].id,
        title: "JavaScript Basics Quiz",
        test_type: "multiple_choice",
        passing_score: 70,
        created_by: admin.id,
      },
      { transaction: t },
    );

    const question = await TestQuestion.create(
      {
        test_id: test.id,
        question_text:
          "What is the correct way to declare a variable in JavaScript?",
        question_type: "multiple_choice",
        points: 1,
        order_index: 0,
      },
      { transaction: t },
    );

    await QuestionOption.bulkCreate(
      [
        {
          question_id: question.id,
          option_text: "variable x = 5",
          is_correct: false,
          order_index: 0,
        },
        {
          question_id: question.id,
          option_text: "let x = 5",
          is_correct: true,
          order_index: 1,
        },
        {
          question_id: question.id,
          option_text: "x := 5",
          is_correct: false,
          order_index: 2,
        },
        {
          question_id: question.id,
          option_text: "var = 5",
          is_correct: false,
          order_index: 3,
        },
      ],
      { transaction: t },
    );

    console.log("✅ Created sample test\n");

    // Add kudos
    console.log("🌟 Adding kudos...");
    await Kudos.bulkCreate(
      [
        {
          from_user_id: supervisor.id,
          to_user_id: learners[0].id,
          points: 5,
          message: "Great work on the React project!",
        },
        {
          from_user_id: learners[0].id,
          to_user_id: learners[1].id,
          points: 3,
          message: "Thanks for helping me debug that issue!",
        },
      ],
      { transaction: t },
    );
    console.log("✅ Added sample kudos\n");

    await t.commit();

    console.log("✅ Database seeding complete!\n");
    console.log("═══════════════════════════════════════");
    console.log("Demo Accounts:");
    console.log("───────────────────────────────────────");
    console.log("Admin:      admin@archetypeos.com");
    console.log("Supervisor: supervisor@archetypeos.com");
    console.log("Learner 1:  john.maker@archetypeos.com");
    console.log("Learner 2:  sarah.architect@archetypeos.com");
    console.log("Learner 3:  mike.strategist@archetypeos.com");
    console.log("");
    console.log("Password for all: password123");
    console.log("═══════════════════════════════════════\n");
  } catch (error) {
    await t.rollback();
    console.error("❌ Database seeding failed:", error.message);
    throw error;
  } finally {
    await sequelize.close();
  }
}

seedData().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
