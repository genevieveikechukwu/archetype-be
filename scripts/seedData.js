const bcrypt = require('bcrypt');
const { pool } = require('../config/database');

async function seedData() {
  const client = await pool.connect();
  
  try {
    console.log('🌱 Starting database seeding...\n');
    await client.query('BEGIN');

    // Hash password for demo users
    const password = await bcrypt.hash('password123', 10);

    // Create Admin
    console.log('👤 Creating admin user...');
    const adminResult = await client.query(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      ['admin@archetypeos.com', password, 'System Admin', 'admin']
    );
    const adminId = adminResult.rows[0].id;
    console.log('✅ Admin created: admin@archetypeos.com / password123\n');

    // Create Supervisor
    console.log('👤 Creating supervisor user...');
    const supervisorResult = await client.query(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      ['supervisor@archetypeos.com', password, 'Jane Supervisor', 'supervisor']
    );
    const supervisorId = supervisorResult.rows[0].id;
    console.log('✅ Supervisor created: supervisor@archetypeos.com / password123\n');

    // Create Learners
    console.log('👥 Creating learner users...');
    const learners = [
      { email: 'john.maker@archetypeos.com', name: 'John Maker', archetype: 'maker' },
      { email: 'sarah.architect@archetypeos.com', name: 'Sarah Architect', archetype: 'architect' },
      { email: 'mike.strategist@archetypeos.com', name: 'Mike Strategist', archetype: 'strategist' }
    ];

    const learnerIds = [];
    for (const learner of learners) {
      const result = await client.query(
        `INSERT INTO users (email, password_hash, full_name, role, archetype, supervisor_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [learner.email, password, learner.name, 'learner', learner.archetype, supervisorId]
      );
      learnerIds.push(result.rows[0].id);
      console.log(`✅ Learner created: ${learner.email} / password123`);
    }
    console.log('');

    // Create Skills
    console.log('🎯 Creating skills...');
    const skills = [
      { name: 'JavaScript', description: 'JavaScript programming language' },
      { name: 'React', description: 'React.js library for building UIs' },
      { name: 'Node.js', description: 'Server-side JavaScript runtime' },
      { name: 'PostgreSQL', description: 'Relational database management' },
      { name: 'System Design', description: 'Software architecture and design patterns' },
      { name: 'Problem Solving', description: 'Algorithmic thinking and problem solving' }
    ];

    const skillIds = [];
    for (const skill of skills) {
      const result = await client.query(
        'INSERT INTO skills (name, description) VALUES ($1, $2) RETURNING id',
        [skill.name, skill.description]
      );
      skillIds.push(result.rows[0].id);
    }
    console.log(`✅ Created ${skills.length} skills\n`);

    // Create Courses
    console.log('📚 Creating courses...');
    const courses = [
      {
        title: 'JavaScript Fundamentals',
        description: 'Learn the basics of JavaScript programming',
        difficulty: 'beginner',
        archetype: 'maker',
        estimated_hours: 20,
        skills: [0, 5] // JavaScript, Problem Solving
      },
      {
        title: 'React for Beginners',
        description: 'Build modern web applications with React',
        difficulty: 'beginner',
        archetype: 'maker',
        estimated_hours: 30,
        skills: [0, 1] // JavaScript, React
      },
      {
        title: 'Backend with Node.js',
        description: 'Server-side development with Node.js and Express',
        difficulty: 'intermediate',
        archetype: 'architect',
        estimated_hours: 40,
        skills: [0, 2, 3] // JavaScript, Node.js, PostgreSQL
      },
      {
        title: 'System Design Principles',
        description: 'Learn to design scalable systems',
        difficulty: 'advanced',
        archetype: 'architect',
        estimated_hours: 50,
        skills: [4] // System Design
      }
    ];

    const courseIds = [];
    for (const course of courses) {
      const result = await client.query(
        `INSERT INTO courses (title, description, difficulty, archetype, estimated_hours, is_published, created_by)
         VALUES ($1, $2, $3, $4, $5, true, $6)
         RETURNING id`,
        [course.title, course.description, course.difficulty, course.archetype, course.estimated_hours, adminId]
      );
      const courseId = result.rows[0].id;
      courseIds.push(courseId);

      // Link skills to course
      for (const skillIndex of course.skills) {
        await client.query(
          'INSERT INTO course_skills (course_id, skill_id, weight) VALUES ($1, $2, 1.0)',
          [courseId, skillIds[skillIndex]]
        );
      }

      // Add sample content
      await client.query(
        `INSERT INTO course_content (course_id, title, content_type, content_url, order_index)
         VALUES 
           ($1, 'Introduction Video', 'video', 'https://example.com/video1.mp4', 0),
           ($1, 'Course Materials PDF', 'pdf', 'https://example.com/materials.pdf', 1),
           ($1, 'Official Documentation', 'link', 'https://example.com/docs', 2)`,
        [courseId]
      );
    }
    console.log(`✅ Created ${courses.length} courses\n`);

    // Enroll learners in courses
    console.log('📝 Enrolling learners in courses...');
    for (let i = 0; i < learnerIds.length; i++) {
      const coursesToEnroll = i === 0 ? [0, 1] : i === 1 ? [1, 2] : [2, 3];
      
      for (const courseIndex of coursesToEnroll) {
        await client.query(
          'INSERT INTO enrollments (user_id, course_id, progress_percentage) VALUES ($1, $2, $3)',
          [learnerIds[i], courseIds[courseIndex], Math.floor(Math.random() * 100)]
        );
      }
    }
    console.log('✅ Learners enrolled in courses\n');

    // Add learning sessions
    console.log('⏰ Creating learning sessions...');
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      
      for (const learnerId of learnerIds) {
        const hours = 5 + Math.random() * 3; // 5-8 hours
        const startTime = new Date(date);
        startTime.setHours(9, 0, 0, 0);
        const endTime = new Date(startTime);
        endTime.setHours(startTime.getHours() + Math.floor(hours));

        await client.query(
          `INSERT INTO learning_sessions (user_id, start_time, end_time, reflection_text)
           VALUES ($1, $2, $3, $4)`,
          [
            learnerId,
            startTime.toISOString(),
            endTime.toISOString(),
            `Worked on ${['React components', 'API development', 'database design', 'problem solving'][Math.floor(Math.random() * 4)]} today. Made good progress.`
          ]
        );
      }
    }
    console.log('✅ Created learning sessions for past 7 days\n');

    // Create tests
    console.log('📝 Creating tests...');
    const test1Result = await client.query(
      `INSERT INTO tests (course_id, title, test_type, passing_score, created_by)
       VALUES ($1, 'JavaScript Basics Quiz', 'multiple_choice', 70, $2)
       RETURNING id`,
      [courseIds[0], adminId]
    );
    const testId = test1Result.rows[0].id;

    // Add questions
    const q1Result = await client.query(
      `INSERT INTO test_questions (test_id, question_text, question_type, points, order_index)
       VALUES ($1, 'What is the correct way to declare a variable in JavaScript?', 'multiple_choice', 1, 0)
       RETURNING id`,
      [testId]
    );

    await client.query(
      `INSERT INTO question_options (question_id, option_text, is_correct, order_index)
       VALUES 
         ($1, 'variable x = 5', false, 0),
         ($1, 'let x = 5', true, 1),
         ($1, 'x := 5', false, 2),
         ($1, 'var = 5', false, 3)`,
      [q1Result.rows[0].id]
    );

    console.log('✅ Created sample test\n');

    // Add kudos
    console.log('🌟 Adding kudos...');
    await client.query(
      `INSERT INTO kudos (from_user_id, to_user_id, points, message)
       VALUES 
         ($1, $2, 5, 'Great work on the React project!'),
         ($2, $3, 3, 'Thanks for helping me debug that issue!')`,
      [supervisorId, learnerIds[0], learnerIds[1]]
    );
    console.log('✅ Added sample kudos\n');

    await client.query('COMMIT');

    console.log('✅ Database seeding complete!\n');
    console.log('═══════════════════════════════════════');
    console.log('Demo Accounts:');
    console.log('───────────────────────────────────────');
    console.log('Admin:      admin@archetypeos.com');
    console.log('Supervisor: supervisor@archetypeos.com');
    console.log('Learner 1:  john.maker@archetypeos.com');
    console.log('Learner 2:  sarah.architect@archetypeos.com');
    console.log('Learner 3:  mike.strategist@archetypeos.com');
    console.log('');
    console.log('Password for all: password123');
    console.log('═══════════════════════════════════════\n');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Database seeding failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seedData().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});